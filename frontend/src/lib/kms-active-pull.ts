/**
 * Active-pull KMS callback utility.
 *
 * Spec: docs/ADR/0003-frontend-as-primary-executor.md
 *
 * The ZamaDrop contract emits two encrypted handles that need a Gateway
 * threshold-MPC decryption + callback to advance state:
 *
 *   1. `finalizeCheckHandle` (ebool) — set by `finalize()`, drives the
 *      Finalizing → Claiming/Failed transition via `callbackFinalize`.
 *   2. `pendingClaimHandle[recipient]` (euint64) — set by `claim()`,
 *      drives the actual ERC-20 settlement via `executeTransfer`.
 *
 * Both handles are `makePubliclyDecryptable`'d on chain, meaning anyone
 * with relayer SDK access can ask the Gateway to decrypt them and obtain
 * a threshold-signed proof. The contract verifies the proof via
 * `FHE.checkSignatures`; caller identity is irrelevant (ADR 0001).
 *
 * Per ADR 0003, the frontend is the primary submitter. Recipients pay
 * the small executeTransfer gas themselves; admins pay the
 * callbackFinalize gas. No off-chain `executor` service is required for
 * happy-path flows.
 *
 * Failure modes:
 *   - Gateway unreachable after retries → CallbackError("decrypt_failed")
 *   - Tx revert because state already advanced concurrently → swallowed
 *     (we trust on-chain truth)
 *   - callbackFinalize result === false → caller decides; the function
 *     returns the boolean so UI can branch.
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";

import { CAMPAIGN_ABI } from "@/abis";

/** Active-pull retry budget. Each attempt asks the Gateway to run
 * threshold MPC; on a healthy network this returns in ~3-10s. */
const PUBLIC_DECRYPT_MAX_ATTEMPTS = 3;
const PUBLIC_DECRYPT_RETRY_MS = 5_000;

/** State enum numeric values — must mirror `enum State` in
 * ZamaDropCampaign.sol. */
const STATE_FINALIZING = 1;
const STATE_CLAIMING = 2;
const STATE_FAILED = 3;

export interface ActivePullContext {
  walletClient: WalletClient;
  publicClient: PublicClient;
  fhevm: FhevmInstance;
  /** Address that signs the resulting callback tx and pays gas.
   * For finalize: admin. For executeTransfer: recipient (themselves). */
  callerAddress: Address;
}

/** Distinguishes "Gateway didn't respond" from "Gateway returned a
 * negative result" so UIs can render different remediation copy. */
export class CallbackError extends Error {
  readonly kind: "decrypt_failed" | "tx_failed";
  constructor(
    message: string,
    kind: "decrypt_failed" | "tx_failed",
  ) {
    super(message);
    this.kind = kind;
    this.name = "CallbackError";
  }
}

async function pullDecryption(
  ctx: ActivePullContext,
  handle: Hex,
): Promise<Awaited<ReturnType<FhevmInstance["publicDecrypt"]>>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PUBLIC_DECRYPT_MAX_ATTEMPTS; attempt++) {
    try {
      return await ctx.fhevm.publicDecrypt([handle]);
    } catch (err) {
      lastError = err;
      if (attempt < PUBLIC_DECRYPT_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, PUBLIC_DECRYPT_RETRY_MS));
      }
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new CallbackError(
    `Gateway publicDecrypt failed after ${PUBLIC_DECRYPT_MAX_ATTEMPTS} attempts (${msg}). The encrypted handle remains on chain — retry once the gateway is responsive.`,
    "decrypt_failed",
  );
}

/**
 * Active-pull KMS verification + callbackFinalize submission.
 *
 * Used by wizard Step 5.5 and AdminPage FinalizePanel after `finalize()`
 * lands. Returns the decrypted boolean so UI can route Claiming vs Failed.
 *
 * Race-safe: if Gateway concurrently pushed a callback (legacy executor
 * still running, multi-tab), our submission may revert NotFinalizing —
 * swallowed if state already advanced.
 */
export async function pullAndCallbackFinalize(
  campaignAddress: Address,
  ctx: ActivePullContext,
): Promise<{ result: boolean }> {
  const stateBefore = (await ctx.publicClient.readContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "state",
  })) as number;
  if (stateBefore === STATE_CLAIMING) return { result: true };
  if (stateBefore === STATE_FAILED) return { result: false };
  if (stateBefore !== STATE_FINALIZING) {
    throw new Error(
      `Expected Finalizing state for callback, got ${stateBefore}.`,
    );
  }

  const handle = (await ctx.publicClient.readContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "finalizeCheckHandle",
  })) as Hex;

  const decrypted = await pullDecryption(ctx, handle);
  const sumMatched = decrypted.clearValues[handle] as boolean;

  try {
    const tx = await ctx.walletClient.writeContract({
      abi: CAMPAIGN_ABI,
      address: campaignAddress,
      functionName: "callbackFinalize",
      args: [sumMatched, decrypted.decryptionProof],
      account: ctx.callerAddress,
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
    // State advanced concurrently — honour on-chain truth.
  }

  return { result: sumMatched };
}

/**
 * Active-pull amount decryption + executeTransfer submission.
 *
 * Used by RecipientPage after the recipient's `claim()` tx mines. The
 * recipient signs and pays gas for the executeTransfer themselves
 * (~50k gas) — replaces the legacy off-chain executor service.
 *
 * Race-safe: returns early if `transferred[user]` is already true.
 */
export async function pullAndExecuteTransfer(
  campaignAddress: Address,
  recipientAddress: Address,
  ctx: ActivePullContext,
): Promise<{ amount: bigint; alreadyTransferred: boolean }> {
  const alreadyTransferred = (await ctx.publicClient.readContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "transferred",
    args: [recipientAddress],
  })) as boolean;
  if (alreadyTransferred) {
    return { amount: 0n, alreadyTransferred: true };
  }

  const handle = (await ctx.publicClient.readContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "pendingClaimHandle",
    args: [recipientAddress],
  })) as Hex;

  const decrypted = await pullDecryption(ctx, handle);
  const amount = decrypted.clearValues[handle] as bigint;

  try {
    const tx = await ctx.walletClient.writeContract({
      abi: CAMPAIGN_ABI,
      address: campaignAddress,
      functionName: "executeTransfer",
      args: [recipientAddress, amount, decrypted.decryptionProof],
      account: ctx.callerAddress,
      chain: ctx.walletClient.chain,
    });
    await ctx.publicClient.waitForTransactionReceipt({ hash: tx });
  } catch (err) {
    const settled = (await ctx.publicClient.readContract({
      address: campaignAddress,
      abi: CAMPAIGN_ABI,
      functionName: "transferred",
      args: [recipientAddress],
    })) as boolean;
    if (!settled) throw err;
  }

  return { amount, alreadyTransferred: false };
}
