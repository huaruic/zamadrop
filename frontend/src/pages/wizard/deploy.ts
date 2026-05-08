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
  CallbackError,
  pullAndCallbackFinalize,
} from "@/lib/kms-active-pull";

import {
  CAMPAIGN_CONSTRUCTOR_ABI,
  CAMPAIGN_CREATION_BYTECODE,
} from "./campaign-bytecode";
import type { DraftSnapshot, Recipient } from "./state";

export type DeploySubStep = 1 | 2 | 3 | 4 | 5;

/** Fine-grained phase within a sub-step. Lets the UI tell apart
 *   - "waiting for the user to click Confirm in their wallet" (popup hint
 *     after 8s, faucet links, etc.)
 *   - "tx submitted, watching mempool" (Etherscan link is now meaningful)
 *   - "tx mined, waiting on indexer/confirmation"
 *   - "asking the Gateway to run threshold-MPC decryption" (5.5 only)
 *
 * Backwards compatible: old call sites that don't pass `meta` still work. */
export type DeployPhase =
  | "awaiting_signature"
  | "tx_submitted"
  | "tx_confirming"
  | "verifying_kms";

export interface DeployProgressMeta {
  phase?: DeployPhase;
  txHash?: Hex;
}

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
  onProgress: (
    step: DeploySubStep,
    detail?: string,
    meta?: DeployProgressMeta,
  ) => void;
  onAllocated: (recipientAddress: string) => void;
}

/** Campaign State enum — must mirror `enum State` in ZamaDropCampaign.sol.
 * Used by `finalizeCampaign` to skip a redundant on-chain finalize when the
 * campaign has already advanced past Setup (idempotent retry support). */
const STATE_SETUP = 0;

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
  // Drops with N > 5 use the batched primitive (setAllocationsBatch) to
  // collapse N wallet signatures into ⌈N / BATCH_SIZE⌉ — for N=500, this
  // is 16 popups instead of 500. See openspec/changes/bulk-allocation/
  // design.md §1 for the BATCH_SIZE = 32 derivation. Small drops (≤ 5)
  // keep the single-call path so trivial campaigns still spend exactly
  // one popup per recipient with no batching overhead.
  const pending = ctx.recipients.filter(
    (r) => !ctx.alreadyAllocated?.has(r.address.toLowerCase()),
  );
  const totalToWrite = pending.length;
  const totalRecipients = ctx.recipients.length;
  const skipped = totalRecipients - totalToWrite;
  if (skipped > 0) {
    ctx.onProgress(3, `${skipped} already allocated, skipping`);
  }
  if (totalToWrite === 0) {
    ctx.onProgress(3, `${totalRecipients}/${totalRecipients} done (resumed)`);
  } else if (totalToWrite <= 5) {
    let written = 0;
    for (const r of pending) {
      const label = `${written + 1}/${totalToWrite}`;
      ctx.onProgress(3, `${label} encrypting…`);
      await setOneAllocation(ctx, campaignAddress, r, label);
      ctx.onAllocated(r.address);
      written += 1;
      ctx.onProgress(3, `${label} done`);
    }
  } else {
    await setAllocationsBatched(ctx, campaignAddress, pending);
  }

  // ── 5.4 finalize ──────────────────────────────────────────────────
  ctx.onProgress(4, "Submitting finalize…");
  await finalizeCampaign(ctx, campaignAddress);
  ctx.onProgress(4, "Finalize submitted.");

  // ── 5.5 Verify with KMS (active pull) ────────────────────────────
  // pullAndCallbackFinalize internally does publicDecrypt → callbackFinalize.
  // We can't introspect its phases without changing the helper, so we surface
  // the verifying_kms phase up front and let the wallet popup hint kick in
  // naturally if the callback signature blocks for >8s on the user.
  ctx.onProgress(5, "Asking gateway to decrypt sum check…", {
    phase: "verifying_kms",
  });
  try {
    const { result } = await pullAndCallbackFinalize(campaignAddress, {
      walletClient: ctx.walletClient,
      publicClient: ctx.publicClient,
      fhevm: ctx.fhevm,
      callerAddress: ctx.adminAddress,
    });
    if (!result) {
      throw new FinalizeFailureError(
        "KMS reports the sum of allocations does not match declaredTotal. State is now Failed; use cancelCampaign in the admin view to recover funds, then redeploy with corrected amounts.",
        campaignAddress,
        "failed",
      );
    }
  } catch (err) {
    if (err instanceof FinalizeFailureError) throw err;
    if (err instanceof CallbackError && err.kind === "decrypt_failed") {
      throw new FinalizeFailureError(err.message, campaignAddress, "timeout");
    }
    throw err;
  }
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

  ctx.onProgress(1, "Awaiting wallet signature…", {
    phase: "awaiting_signature",
  });
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
  ctx.onProgress(1, "Tx submitted…", { phase: "tx_submitted", txHash: hash });
  ctx.onProgress(1, "Confirming on chain…", {
    phase: "tx_confirming",
    txHash: hash,
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
  // Idempotent: if a previous attempt already transferred the declared total
  // (or more), skip the transfer entirely. Without this guard, a Retry after
  // a Step 5.5 KMS failure would double-fund the campaign because the store's
  // `existingCampaignAddress` is set on FinalizeFailureError.
  const existing = (await ctx.publicClient.readContract({
    address: ctx.tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [campaignAddress],
  })) as bigint;
  if (existing >= ctx.snapshot.declaredTotal) {
    ctx.onProgress(2, "Already funded — skipped.");
    return;
  }

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [campaignAddress, ctx.snapshot.declaredTotal],
  });
  ctx.onProgress(2, "Awaiting wallet signature…", {
    phase: "awaiting_signature",
  });
  // Use sendTransaction directly so we can pass the encoded calldata to the
  // ERC20 token contract regardless of any wagmi cache state.
  const hash = await ctx.walletClient.sendTransaction({
    account: ctx.adminAddress,
    chain: ctx.walletClient.chain,
    to: ctx.tokenAddress,
    data,
  });
  ctx.onProgress(2, "Tx submitted…", { phase: "tx_submitted", txHash: hash });
  ctx.onProgress(2, "Confirming on chain…", {
    phase: "tx_confirming",
    txHash: hash,
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

/** Maximum recipients per setAllocationsBatch call. The Zama relayer SDK
 * caps a single createEncryptedInput proof at 2048 bits / 64 bits per
 * uint64 = 32 values; the on-chain FHE.fromExternal verify gas (~500k
 * each) means a 32-recipient batch costs ~16M gas, comfortably under
 * the Sepolia 30M block limit. See openspec/changes/bulk-allocation/
 * design.md §1. Bumping this requires either an FHE protocol change or
 * an EVM block-gas regression — not a tunable. */
const BATCH_SIZE = 32;

/** Chunk a recipient list into ≤BATCH_SIZE groups and submit each as
 * one setAllocationsBatch tx. The whole batch shares a single relayer
 * SDK proof (every add64 in the same createEncryptedInput call goes
 * into the same inputProof). Caller-side resume support: pass the
 * already-completed recipients out via ctx.alreadyAllocated; this
 * function operates on the filtered "still-needed" list. */
async function setAllocationsBatched(
  ctx: DeployContext,
  campaignAddress: Address,
  pending: Recipient[],
): Promise<void> {
  const totalBatches = Math.ceil(pending.length / BATCH_SIZE);
  let written = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const chunk = pending.slice(i, i + BATCH_SIZE);
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
    const batchLabel = `batch ${batchIndex}/${totalBatches}`;

    ctx.onProgress(
      3,
      `${batchLabel} encrypting ${chunk.length} amounts…`,
    );

    // Pack all amounts in this chunk into a single relayer SDK input
    // proof. Each add64 contributes one handle to ciphertexts.handles[],
    // and ciphertexts.inputProof covers them all together. The contract
    // re-uses this same proof for every FHE.fromExternal call in the
    // loop body — no duplication on chain.
    const buffer = ctx.fhevm.createEncryptedInput(
      getAddress(campaignAddress),
      getAddress(ctx.adminAddress),
    );
    for (const r of chunk) buffer.add64(r.amount);
    const ciphertexts = await buffer.encrypt();
    const handles = ciphertexts.handles.map((h: Uint8Array | string) =>
      toHex(h),
    );
    const proof = toHex(ciphertexts.inputProof);

    ctx.onProgress(3, `${batchLabel} awaiting wallet signature…`, {
      phase: "awaiting_signature",
    });
    const hash = await ctx.walletClient.writeContract({
      abi: CAMPAIGN_ABI,
      address: campaignAddress,
      functionName: "setAllocationsBatch",
      args: [chunk.map((r) => r.address), handles, proof],
      account: ctx.adminAddress,
      chain: ctx.walletClient.chain,
    });
    ctx.onProgress(3, `${batchLabel} tx submitted…`, {
      phase: "tx_submitted",
      txHash: hash,
    });
    ctx.onProgress(3, `${batchLabel} confirming on chain…`, {
      phase: "tx_confirming",
      txHash: hash,
    });
    await ctx.publicClient.waitForTransactionReceipt({ hash });

    // Mark every recipient in this chunk as allocated only after the
    // tx confirms — atomicity matches the contract's loop semantics.
    for (const r of chunk) ctx.onAllocated(r.address);
    written += chunk.length;
    ctx.onProgress(
      3,
      `${written}/${pending.length} done (${batchLabel})`,
    );
  }
}

async function setOneAllocation(
  ctx: DeployContext,
  campaignAddress: Address,
  recipient: Recipient,
  label: string,
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

  ctx.onProgress(3, `${label} awaiting wallet signature…`, {
    phase: "awaiting_signature",
  });
  const hash = await ctx.walletClient.writeContract({
    abi: CAMPAIGN_ABI,
    address: campaignAddress,
    functionName: "setAllocation",
    args: [recipient.address, handle, proof],
    account: ctx.adminAddress,
    chain: ctx.walletClient.chain,
  });
  ctx.onProgress(3, `${label} tx submitted…`, {
    phase: "tx_submitted",
    txHash: hash,
  });
  ctx.onProgress(3, `${label} confirming on chain…`, {
    phase: "tx_confirming",
    txHash: hash,
  });
  await ctx.publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function finalizeCampaign(
  ctx: DeployContext,
  campaignAddress: Address,
): Promise<void> {
  // Idempotent: if the campaign has already advanced past Setup (Finalizing /
  // Claiming / Failed), a second `finalize()` would revert and burn gas. Skip
  // cleanly so a Retry after a 5.5 KMS failure can re-run only the active-pull
  // step.
  const currentState = (await ctx.publicClient.readContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "state",
  })) as number;
  if (currentState !== STATE_SETUP) {
    ctx.onProgress(4, "Already finalized — skipped.");
    return;
  }

  ctx.onProgress(4, "Awaiting wallet signature…", {
    phase: "awaiting_signature",
  });
  const hash = await ctx.walletClient.writeContract({
    abi: CAMPAIGN_ABI,
    address: campaignAddress,
    functionName: "finalize",
    args: [],
    account: ctx.adminAddress,
    chain: ctx.walletClient.chain,
  });
  ctx.onProgress(4, "Tx submitted…", { phase: "tx_submitted", txHash: hash });
  ctx.onProgress(4, "Confirming on chain…", {
    phase: "tx_confirming",
    txHash: hash,
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

function toHex(v: Uint8Array | string): Hex {
  if (typeof v === "string") {
    return (v.startsWith("0x") ? v : `0x${v}`) as Hex;
  }
  let hex = "";
  for (let i = 0; i < v.length; i++) hex += v[i].toString(16).padStart(2, "0");
  return `0x${hex}` as Hex;
}
