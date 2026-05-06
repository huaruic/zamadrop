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
 *   5.5  Wait for KMS callback — poll `state` until Claiming, with timeout
 *
 * Each sub-step is a separate user-visible signature. We progress-callback
 * after every one so the UI can render a strip + recipient counter.
 */

import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";
import {
  decodeEventLog,
  encodeFunctionData,
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

/** Thrown when finalize submitted but the KMS callback didn't arrive within
 * the timeout window, OR when `state` settles to `Failed` (sum mismatch).
 * UI surfaces a remediation hint pointing at withdrawExcess / cancelCampaign. */
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

/** Total time to wait for the KMS callback after finalize() lands on chain.
 * Spec: 5 minutes. */
const KMS_CALLBACK_TIMEOUT_MS = 5 * 60_000;
/** Polling cadence for `state()` while waiting for KMS callback. */
const POLL_INTERVAL_MS = 5_000;

const STATE_FAILED = 3;
const STATE_CLAIMING = 2;

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

  // ── 5.5 Wait for KMS callback ────────────────────────────────────
  ctx.onProgress(5, "Waiting for KMS callback…");
  await waitForClaiming(ctx, campaignAddress);
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
  const buffer = ctx.fhevm.createEncryptedInput(
    campaignAddress,
    ctx.adminAddress,
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

async function waitForClaiming(
  ctx: DeployContext,
  campaignAddress: Address,
): Promise<void> {
  const deadline = Date.now() + KMS_CALLBACK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const stateNum = (await ctx.publicClient.readContract({
      address: campaignAddress,
      abi: CAMPAIGN_ABI,
      functionName: "state",
    })) as number;
    if (stateNum === STATE_CLAIMING) return;
    if (stateNum === STATE_FAILED) {
      throw new FinalizeFailureError(
        "Finalize check failed (campaign entered Failed state). Use cancelCampaign to recover funds, then redeploy.",
        campaignAddress,
        "failed",
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new FinalizeFailureError(
    "KMS callback did not arrive within 5 minutes. Use withdrawExcess once Claiming, or cancelCampaign if it lands Failed, then redeploy.",
    campaignAddress,
    "timeout",
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toHex(v: Uint8Array | string): Hex {
  if (typeof v === "string") {
    return (v.startsWith("0x") ? v : `0x${v}`) as Hex;
  }
  let hex = "";
  for (let i = 0; i < v.length; i++) hex += v[i].toString(16).padStart(2, "0");
  return `0x${hex}` as Hex;
}
