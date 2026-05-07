/**
 * Step 5 — direct-wallet deployment executor.
 *
 * Spec: openspec/changes/v7-dapp-wizard/specs/admin-deployment-flow/spec.md
 *       §"Step 5 — 5 个上链子步骤"
 *
 *   5.1  Deploy ZamaDropCampaign — Admin EOA → CREATE (no Factory contract)
 *   5.2  Fund — token.transfer(campaign, declaredTotal)
 *   5.3  setAllocation × N — encrypt amount client-side, submit one tx each
 *   5.4  finalize() — Admin tx; emits FinalizeRequested
 *   5.5  Verify with KMS (active pull) — relayer SDK publicDecrypt the
 *         sum-check handle, then admin self-submits callbackFinalize.
 *
 * The active-pull design (LEARNINGS.md "V7 wizard 5.5 from passive polling
 * to active pull, 2026-05-07") replaces the original passive
 * Gateway-push-then-poll model that was vulnerable to missed event
 * subscriptions on Sepolia (observed 30+ minute stalls). The encrypted
 * sumCheck handle is on chain and already publicly-decryptable; we ask
 * the Gateway directly via the relayer SDK and submit the threshold-MPC
 * proof ourselves. End-to-end latency ~10–15 s.
 */

import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";
import {
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import { CAMPAIGN_ABI, ERC20_ABI } from "@/abis";

import {
  CAMPAIGN_CONSTRUCTOR_ABI,
  CAMPAIGN_CREATION_BYTECODE,
} from "./campaign-bytecode";
import type { DraftSnapshot, Recipient } from "./state";

export type DeploySubStep = 1 | 2 | 3 | 4 | 5;

export interface DeployContext {
  walletClient: WalletClient;
  publicClient: PublicClient;
  fhevm: FhevmInstance;
  /** The Step-4 captured snapshot. We pass declaredTotal/listHash from here
   * directly into the constructor call to ensure we deploy what the user
   * confirmed, not stale store data. */
  snapshot: DraftSnapshot;
  recipients: Recipient[];
  auditor: Address;
  tokenAddress: Address;
  /** Connected admin EOA address. */
  adminAddress: Address;
  /** Pre-existing allocations to skip during sub-step 5.3 (resume support). */
  alreadyAllocated?: ReadonlySet<string>;
  /** Optional pre-deployed campaign address (resume after 5.1 success). */
  existingCampaignAddress?: Address;

  // Progress + per-recipient hooks
  onProgress: (step: DeploySubStep, detail?: string) => void;
  onAllocated: (recipientAddress: string) => void;
}

/** Thrown when the KMS verification at step 5.5 fails:
 *   - `kind === "timeout"`: relayer SDK publicDecrypt failed after retries
 *     (gateway unreachable / threshold quorum down). State stays Finalizing
 *     on chain; admin can re-enter the wizard later or use the V8 escape
 *     hatch once shipped.
 *   - `kind === "failed"`: gateway returned a valid proof showing the sum
 *     of allocations did not match declaredTotal. State is now Failed;
 *     admin should call cancelCampaign in the admin view to recover funds. */
export class FinalizeFailureError extends Error {
  readonly campaignAddress: Address;
  readonly kind: "timeout" | "failed";

  constructor(
    message: string,
    campaignAddress: Address,
    kind: "timeout" | "failed",
  ) {
    super(message);
    this.name = "FinalizeFailureError";
    this.campaignAddress = campaignAddress;
    this.kind = kind;
  }
}

/** Active-pull retry budget. Each attempt asks the Gateway to run threshold
 * MPC; on a healthy network this returns in ~3-10s. Three attempts with 5s
 * backoff covers transient network blips while still bounding total wait. */
const PUBLIC_DECRYPT_MAX_ATTEMPTS = 3;
const PUBLIC_DECRYPT_RETRY_MS = 5_000;

/** State enum numeric values mirroring `enum State` in ZamaDropCampaign.sol. */
const STATE_FINALIZING = 1;
const STATE_CLAIMING = 2;
const STATE_FAILED = 3;

/** Run the 5 sub-steps end-to-end. Returns the deployed campaign address.
 * Throws on any unrecoverable error — caller is responsible for rendering. */
export async function executeDeployment(
  ctx: DeployContext,
): Promise<Address> {
  // ── 5.1 Deploy ────────────────────────────────────────────────────
  let campaignAddress: Address;
  if (ctx.existingCampaignAddress) {
    campaignAddress = ctx.existingCampaignAddress;
    ctx.onProgress(1, `Resumed at ${campaignAddress}`);
  } else {
    ctx.onProgress(1, "Deploying ZamaDropCampaign…");
    campaignAddress = await deployCampaign(ctx);
    ctx.onProgress(1, `Deployed at ${campaignAddress}`);
  }

  // ── 5.2 Fund ──────────────────────────────────────────────────────
  ctx.onProgress(2, "Funding campaign with declared total…");
  await fundCampaign(ctx, campaignAddress);
  ctx.onProgress(2, "Funded.");

  // ── 5.3 setAllocation × N ─────────────────────────────────────────
  const N = ctx.recipients.length;
  for (let i = 0; i < N; i++) {
    const r = ctx.recipients[i];
    if (ctx.alreadyAllocated?.has(r.address.toLowerCase())) {
      ctx.onProgress(3, `${i + 1}/${N} (already allocated, skipped)`);
      continue;
    }
    ctx.onProgress(3, `${i + 1}/${N} encrypting…`);
    await setOneAllocation(ctx, campaignAddress, r);
    ctx.onAllocated(r.address);
    ctx.onProgress(3, `${i + 1}/${N} done`);
  }

  // ── 5.4 finalize ──────────────────────────────────────────────────
  ctx.onProgress(4, "Submitting finalize…");
  await finalizeCampaign(ctx, campaignAddress);
  ctx.onProgress(4, "Finalize submitted.");

  // ── 5.5 Verify with KMS (active pull) ────────────────────────────
  ctx.onProgress(5, "Asking gateway to decrypt sum check…");
  await pullAndCallback(ctx, campaignAddress);
  ctx.onProgress(5, "Campaign live.");

  return campaignAddress;
}

async function deployCampaign(ctx: DeployContext): Promise<Address> {
  const args = [
    ctx.adminAddress,
    ctx.auditor,
    ctx.tokenAddress,
    ctx.snapshot.declaredTotal,
    ctx.recipients.map((r) => r.address),
    ctx.snapshot.listHash,
  ] as const;

  // viem walletClient.deployContract returns a tx hash. We then await the
  // receipt and read `contractAddress` for the deployed instance.
  const hash = await ctx.walletClient.deployContract({
    abi: CAMPAIGN_CONSTRUCTOR_ABI,
    bytecode: CAMPAIGN_CREATION_BYTECODE,
    args: args as unknown as readonly [
      Address,
      Address,
      Address,
      bigint,
      readonly Address[],
      Hex,
    ],
    account: ctx.adminAddress,
    chain: ctx.walletClient.chain,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error("Deploy receipt missing contractAddress.");
  }
  return receipt.contractAddress;
}

async function fundCampaign(
  ctx: DeployContext,
  campaignAddress: Address,
): Promise<void> {
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [campaignAddress, ctx.snapshot.declaredTotal],
  });
  // Use sendTransaction directly so we can pass the encoded calldata to the
  // ERC20 token contract regardless of any wagmi cache state.
  const hash = await ctx.walletClient.sendTransaction({
    account: ctx.adminAddress,
    chain: ctx.walletClient.chain,
    to: ctx.tokenAddress,
    data,
  });
  await ctx.publicClient.waitForTransactionReceipt({ hash });

  // Sanity check post-transfer: campaign balance must cover declaredTotal.
  const bal = (await ctx.publicClient.readContract({
    address: ctx.tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [campaignAddress],
  })) as bigint;
  if (bal < ctx.snapshot.declaredTotal) {
    throw new Error(
      `Funding mismatch: campaign balance ${bal} < declared ${ctx.snapshot.declaredTotal}`,
    );
  }
}

async function setOneAllocation(
  ctx: DeployContext,
  campaignAddress: Address,
  recipient: Recipient,
): Promise<Hash> {
  // Encrypt the uint64 amount — buffer is bound to (campaign, admin) per the
  // FHE input verifier's expectations.
  //
  // The relayer SDK's createEncryptedInput requires EIP-55 checksum addresses
  // (it does `getAddress(x) === x` strict-equal). viem returns
  // receipt.contractAddress in lowercase straight from the RPC, and
  // wagmi-provided wallet addresses can also vary. Normalize both here so
  // the FHE proof verification sees the canonical form the contract expects.
  const buffer = ctx.fhevm.createEncryptedInput(
    getAddress(campaignAddress),
    getAddress(ctx.adminAddress),
  );
  buffer.add64(recipient.amount);
  const ciphertexts = await buffer.encrypt();
  const handle = toHex(ciphertexts.handles[0]);
  const proof = toHex(ciphertexts.inputProof);

  const hash = await ctx.walletClient.writeContract({
    abi: CAMPAIGN_ABI,
    address: campaignAddress,
    functionName: "setAllocation",
    args: [recipient.address, handle, proof],
    account: ctx.adminAddress,
    chain: ctx.walletClient.chain,
  });
  await ctx.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function finalizeCampaign(
  ctx: DeployContext,
  campaignAddress: Address,
): Promise<void> {
  const hash = await ctx.walletClient.writeContract({
    abi: CAMPAIGN_ABI,
    address: campaignAddress,
    functionName: "finalize",
    args: [],
    account: ctx.adminAddress,
    chain: ctx.walletClient.chain,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });

  // Surface the FinalizeRequested handle in the console for parity with the
  // existing FinalizePanel UX. Best-effort — if the log isn't found we don't
  // fail; the wait loop below is the source of truth.
  try {
    for (const log of receipt.logs) {
      const decoded = decodeEventLog({
        abi: CAMPAIGN_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "FinalizeRequested") break;
    }
  } catch {
    // ignore — non-matching log shapes throw, we only care about the receipt
    // semantically.
  }
}

/**
 * Active-pull KMS verification + callback submission.
 *
 * Replaces the legacy passive `waitForClaiming` polling loop. The encrypted
 * `finalizeCheckHandle` is already on chain and `makePubliclyDecryptable`'d
 * by `finalize()`; we ask the Gateway directly via relayer SDK
 * `publicDecrypt`, get back the threshold-MPC signed result, and submit
 * `callbackFinalize` ourselves with admin's signature.
 *
 * Failure cases:
 *  - publicDecrypt throws repeatedly → `FinalizeFailureError("timeout")`,
 *    state stays Finalizing on chain (admin can retry later).
 *  - publicDecrypt returns `false` → submit callback so state moves to
 *    Failed, then throw `FinalizeFailureError("failed")` with cancelCampaign
 *    remediation hint.
 *  - callbackFinalize tx reverts because state already advanced (Gateway
 *    happened to push concurrently) → swallow the revert if state is now
 *    Claiming or Failed; otherwise rethrow.
 */
async function pullAndCallback(
  ctx: DeployContext,
  campaignAddress: Address,
): Promise<void> {
  // Guard: someone (Gateway pushing in parallel, or a previous wizard run)
  // may have already advanced past Finalizing. Skip work in that case.
  const stateBefore = (await ctx.publicClient.readContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "state",
  })) as number;
  if (stateBefore === STATE_CLAIMING) return;
  if (stateBefore === STATE_FAILED) {
    throw new FinalizeFailureError(
      "Campaign already in Failed state. Use cancelCampaign in the admin view to recover funds, then redeploy with corrected amounts.",
      campaignAddress,
      "failed",
    );
  }
  if (stateBefore !== STATE_FINALIZING) {
    throw new Error(
      `Unexpected campaign state ${stateBefore} at start of step 5.5; expected Finalizing.`,
    );
  }

  // Read the on-chain ebool handle that finalize() committed.
  const handle = (await ctx.publicClient.readContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "finalizeCheckHandle",
  })) as Hex;

  // Active pull with bounded retries. publicDecrypt asks the Gateway to run
  // threshold MPC and return a signed result; ~3-10s on a healthy day.
  let decrypted: Awaited<ReturnType<typeof ctx.fhevm.publicDecrypt>> | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= PUBLIC_DECRYPT_MAX_ATTEMPTS; attempt++) {
    try {
      decrypted = await ctx.fhevm.publicDecrypt([handle]);
      break;
    } catch (err) {
      lastError = err;
      if (attempt < PUBLIC_DECRYPT_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, PUBLIC_DECRYPT_RETRY_MS));
      }
    }
  }
  if (!decrypted) {
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new FinalizeFailureError(
      `Gateway publicDecrypt failed after ${PUBLIC_DECRYPT_MAX_ATTEMPTS} attempts (${msg}). State remains Finalizing on chain. Re-enter the wizard once the gateway is responsive, or wait for V8's admin escape hatch for prolonged outages.`,
      campaignAddress,
      "timeout",
    );
  }

  const sumMatched = decrypted.clearValues[handle] as boolean;
  const proof = decrypted.decryptionProof;

  // Submit callbackFinalize ourselves. If Gateway concurrently pushed and
  // already advanced state, our tx will revert NotFinalizing; tolerate that
  // by re-reading state and trusting whatever is there.
  try {
    const tx = await ctx.walletClient.writeContract({
      abi: CAMPAIGN_ABI,
      address: campaignAddress,
      functionName: "callbackFinalize",
      args: [sumMatched, proof],
      account: ctx.adminAddress,
      chain: ctx.walletClient.chain,
    });
    await ctx.publicClient.waitForTransactionReceipt({ hash: tx });
  } catch (err) {
    const stateAfter = (await ctx.publicClient.readContract({
      address: campaignAddress,
      abi: CAMPAIGN_ABI,
      functionName: "state",
    })) as number;
    if (stateAfter !== STATE_CLAIMING && stateAfter !== STATE_FAILED) {
      throw err;
    }
    // State already advanced by a concurrent Gateway push — fall through to
    // honour the on-chain truth instead of our own (now-redundant) result.
  }

  if (!sumMatched) {
    throw new FinalizeFailureError(
      "KMS reports the sum of allocations does not match declaredTotal. State is now Failed; use cancelCampaign in the admin view to recover funds, then redeploy with corrected amounts.",
      campaignAddress,
      "failed",
    );
  }
}

function toHex(v: Uint8Array | string): Hex {
  if (typeof v === "string") {
    return (v.startsWith("0x") ? v : `0x${v}`) as Hex;
  }
  let hex = "";
  for (let i = 0; i < v.length; i++) hex += v[i].toString(16).padStart(2, "0");
  return `0x${hex}` as Hex;
}
