import { useState } from "react";
import type { Hex } from "viem";
import {
  usePublicClient,
  useWalletClient,
  useWriteContract,
} from "wagmi";

import { CAMPAIGN_ABI } from "@/abis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ETHERSCAN_BASE } from "@/config";
import { getFhevmInstance } from "@/fhevm";
import {
  CallbackError,
  pullAndExecuteTransfer,
  type SettlePhase,
} from "@/lib/kms-active-pull";
import { cn } from "@/lib/utils";

import { shortHandle } from "./shorten";

type StepState = "idle" | "current" | "done";

/** Settlement state machine for the inner active-pull flow. We split
 * `idle | active | done` so the React render path can read intent
 * directly:
 *
 *   - `idle` — nothing in flight; show the Resume button if claim() has
 *     mined but settlement never started (refresh / dismissed popup).
 *   - `active` — `pullAndExecuteTransfer` is running; render distinct copy
 *     per `phase` and surface an Etherscan link as soon as the user signs
 *     the popup. Five sub-phases mirror `SettlePhase` from
 *     kms-active-pull.ts so wizard and recipient stepper share the same
 *     vocabulary.
 *   - `done` — `executeTransfer` receipt confirmed locally. The chain
 *     read for `transferred[me]` may still be in flight; we use this
 *     state to render a "Verifying chain state…" alert so the UI is
 *     never silent in that gap (Codex review caught this dead state). */
type StepperSettle =
  | { kind: "idle" }
  | { kind: "active"; phase: SettlePhase; txHash?: Hex }
  | { kind: "done"; txHash?: Hex };

interface ClaimStepperProps {
  campaignAddress: `0x${string}`;
  finalized: boolean;
  claimed: boolean;
  transferred: boolean;
  pendingHandle?: `0x${string}`;
  /** Called whenever the on-chain claim/transfer state may have changed
   * (after `claim()` mines, and again after `executeTransfer()` mines).
   * Parent should refetch chain reads. */
  onClaimMined: () => void;
  /** Called once `executeTransfer` receipt is confirmed locally, before
   * the parent's chain reads have necessarily returned. Lets the balance
   * panel skip its 8s tick and refetch immediately, so users don't see
   * "tokens already in wallet (per balance)" + "still settling (per
   * stepper)" race UI. */
  onSettleConfirmed?: () => void;
}

const ZERO_HANDLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Three-step stepper that walks the recipient through claim → settlement → done.
 *
 * V7 active-pull: the recipient signs BOTH `claim()` and `executeTransfer()`
 * themselves in quick succession. After `claim()` mines, the frontend pulls
 * the KMS decryption of `pendingClaimHandle[recipient]` via the relayer SDK
 * and submits `executeTransfer` directly — no off-chain settlement service.
 * See ADR 0003 and `frontend/src/lib/kms-active-pull.ts`. */
export function ClaimStepper({
  campaignAddress,
  finalized,
  claimed,
  transferred,
  pendingHandle,
  onClaimMined,
  onSettleConfirmed,
}: ClaimStepperProps) {
  const { writeContractAsync, isPending: isSubmitting, error: writeError } =
    useWriteContract();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [settle, setSettle] = useState<StepperSettle>({ kind: "idle" });
  const [settleError, setSettleError] = useState<string | null>(null);

  /** Active-pull settle: decrypt pendingClaimHandle via Gateway, then submit
   * executeTransfer. Used by both `handleClaim` (immediately after claim()
   * mines) AND `handleResumeSettle` (when the user lands on the page with
   * `claimed === true && transferred === false` — e.g. they refreshed mid-
   * flow or dismissed the second wallet popup). Pure active-pull, never
   * re-calls claim(). */
  const runSettle = async () => {
    if (!walletClient) throw new Error("Wallet client unavailable.");
    const account = walletClient.account;
    if (!account) throw new Error("No wallet account connected.");
    if (!publicClient) throw new Error("Public client unavailable.");

    // Pre-flight: enter the active state immediately so the UI shows
    // *something* while we wait on `getFhevmInstance` (cold path can be
    // 3-10s the first time the page is loaded).
    setSettle({ kind: "active", phase: "awaiting_decrypt" });
    const fhevm = await getFhevmInstance();
    let lastTxHash: Hex | undefined;
    await pullAndExecuteTransfer(campaignAddress, account.address, {
      walletClient,
      publicClient,
      fhevm,
      callerAddress: account.address,
      onProgress: ({ phase, txHash }) => {
        if (txHash) lastTxHash = txHash;
        setSettle({ kind: "active", phase, txHash: lastTxHash });
      },
    });
    // executeTransfer receipt confirmed (awaitOrThrow inside the helper
    // raises CallbackError on revert, so reaching this line means
    // `transferred[me] = true` is already on chain and atomic with the
    // ERC-20 transfer that just credited the wallet).
    setSettle({ kind: "done", txHash: lastTxHash });
    // Tell the parent immediately so BalancePanel can skip its 8s tick
    // and refetch now. Mirrors `onClaimMined` semantics but is named for
    // its specific purpose (helps the stepper escape the verifying gap).
    onSettleConfirmed?.();
    onClaimMined();
  };

  /** Surface the right error copy for both handlers. */
  const handleSettleError = (err: unknown) => {
    if (err instanceof CallbackError) {
      if (err.kind === "decrypt_failed") {
        setSettleError(
          `${err.message} Click "Resume settlement" once the gateway is healthy.`,
        );
      } else {
        setSettleError(
          `${err.message} The transfer transaction failed — contact the campaign admin if this persists.`,
        );
      }
    } else {
      setSettleError(err instanceof Error ? err.message : String(err));
    }
    setSettle({ kind: "idle" });
  };

  const handleClaim = async () => {
    setSettleError(null);
    try {
      // Step 1: claim() — recipient signs.
      const claimHash = await writeContractAsync({
        address: campaignAddress,
        abi: CAMPAIGN_ABI,
        functionName: "claim",
      });
      if (!publicClient) throw new Error("Public client unavailable.");
      const claimReceipt = await publicClient.waitForTransactionReceipt({
        hash: claimHash,
      });
      // viem `waitForTransactionReceipt` resolves on receipt regardless of
      // status; a reverted claim ships `status: "reverted"`. Without this
      // check we'd silently advance to settle() with `claimed[me] = false`
      // on chain and the user would see an inscrutable AlreadyClaimed/
      // NotClaimed cascade. Same pattern as awaitOrThrow in
      // kms-active-pull.ts.
      if (claimReceipt.status !== "success") {
        throw new Error(
          `claim() reverted on-chain (tx ${claimHash}). Refresh the page and try again — if this persists, the campaign may not be in Claiming state yet.`,
        );
      }
      onClaimMined();

      // Step 2: active-pull settle — recipient signs the second wallet popup.
      await runSettle();
    } catch (err) {
      handleSettleError(err);
    }
  };

  /** Resume Step 2 only — when claim() already mined in a prior visit but
   * the active-pull never completed (refresh, dismissed wallet popup, etc.).
   * Calling claim() again would revert AlreadyClaimed. */
  const handleResumeSettle = async () => {
    setSettleError(null);
    try {
      await runSettle();
    } catch (err) {
      handleSettleError(err);
    }
  };

  // Step state derivation. `transferred` is the on-chain truth and the
  // primary driver. But it can lag the local `runSettle` completion by a
  // RPC roundtrip + React re-render gap (Codex review caught this); when
  // `settle.kind === "done"` we treat step2/step3 as visually done so the
  // UI doesn't sit in a silent "current with no spinner" state.
  const localSettleDone = settle.kind === "done";
  const step1: StepState = claimed ? "done" : finalized ? "current" : "idle";
  const step2: StepState =
    transferred || localSettleDone
      ? "done"
      : claimed
        ? "current"
        : "idle";
  const step3: StepState =
    transferred || localSettleDone ? "done" : "idle";

  const settledHandle =
    pendingHandle && pendingHandle !== ZERO_HANDLE ? pendingHandle : undefined;

  const isSettleActive = settle.kind === "active";
  const claimButtonDisabled = isSubmitting || isSettleActive;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claim & withdraw</CardTitle>
        <CardDescription>
          Two wallet signatures, in quick succession. The first locks in your
          claim; the second pulls the KMS-signed amount and pushes the ERC-20
          transfer.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <Step
          index={1}
          state={step1}
          title="Claim allocation"
          description={
            !finalized
              ? "Waiting for admin to finalize the campaign."
              : claimed
                ? "Claim recorded on-chain."
                : "Submit a transaction to lock in your claim. The amount stays encrypted on chain until you sign the settlement tx."
          }
        >
          {step1 === "current" && (
            <div className="space-y-3">
              <Button
                onClick={handleClaim}
                disabled={claimButtonDisabled}
              >
                {isSubmitting
                  ? "Awaiting wallet…"
                  : isSettleActive
                    ? "Settling…"
                    : "Claim allocation"}
              </Button>
              {writeError && (
                <Alert variant="destructive">
                  <AlertDescription>{writeError.message}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
          {step1 === "idle" && !finalized && !claimed && (
            <Button disabled>Claim allocation</Button>
          )}
        </Step>

        <Step
          index={2}
          state={step2}
          title={step2 === "done" ? "Settlement complete" : "Settling"}
          description={
            step2 === "done"
              ? "KMS decrypted your amount and your `executeTransfer` tx is mined."
              : step2 === "current"
                ? "Decrypting your amount via KMS and submitting the ERC-20 transfer. You'll see a second wallet popup."
                : "Will start after step 1."
          }
        >
          {step2 === "current" && (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-surface p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Pending claim handle
                </div>
                <div className="mt-1 break-all font-mono text-xs">
                  {settledHandle ? shortHandle(settledHandle) : "Loading…"}
                </div>
              </div>
              {/* Resume button: fires only when the active-pull never
                  started or got interrupted. Lets a recipient who dismissed
                  the second wallet popup (or refreshed mid-flow) finish
                  Step 2 without re-calling claim() — that would revert
                  AlreadyClaimed. Hidden while runSettle() is in flight. */}
              {settle.kind === "idle" && !settleError && (
                <Button onClick={handleResumeSettle}>
                  Resume settlement
                </Button>
              )}
              {settle.kind === "active" && (
                <PhaseAlert phase={settle.phase} txHash={settle.txHash} />
              )}
              {settleError && (
                <div className="space-y-2">
                  <Alert variant="destructive">
                    <AlertTitle>Settlement failed</AlertTitle>
                    <AlertDescription>{settleError}</AlertDescription>
                  </Alert>
                  <Button onClick={handleResumeSettle} variant="outline">
                    Retry settlement
                  </Button>
                </div>
              )}
            </div>
          )}
          {/* The "verifying chain state" gap: local settle is done but the
              parent's `transferred` refetch hasn't returned yet, so step2
              flipped to "done" via the localSettleDone fallback. Show a
              soft indicator inside step2's done card so users get a clean
              "waiting for chain to confirm" beat instead of a silent
              transition. Renders briefly (one RPC roundtrip). */}
          {step2 === "done" && !transferred && settle.kind === "done" && (
            <Alert variant="info">
              <AlertTitle>Verifying chain state…</AlertTitle>
              <AlertDescription>
                Transfer mined. Waiting on the page to refresh on-chain
                state — typically &lt; 2 seconds.
              </AlertDescription>
            </Alert>
          )}
        </Step>

        <Step
          index={3}
          state={step3}
          title="Done"
          description="Tokens are in your wallet. Your balance card below will refresh shortly."
        />

      </CardContent>
    </Card>
  );
}

/** Distinct copy + Etherscan link per active-pull phase. Replaces the
 * old single "Submitting transfer… Sign the second wallet popup" copy
 * that was shown for all five sub-stages — including after the user had
 * already signed and the tx was mining, which produced the
 * money-already-in-wallet-but-stepper-still-says-sign dissonance Codex
 * review caught. */
function PhaseAlert({ phase, txHash }: { phase: SettlePhase; txHash?: Hex }) {
  if (phase === "awaiting_decrypt") {
    return (
      <Alert variant="info">
        <AlertTitle>Decrypting amount via KMS…</AlertTitle>
        <AlertDescription>
          Asking the Gateway to run threshold MPC. ~3–10 seconds. The
          wallet popup will appear after this completes — you do not need
          to sign anything yet.
        </AlertDescription>
      </Alert>
    );
  }
  if (phase === "awaiting_signature") {
    return (
      <Alert variant="info">
        <AlertTitle>Sign the wallet popup</AlertTitle>
        <AlertDescription>
          A second wallet popup is now open. Confirm to push the ERC-20
          transfer on-chain.
        </AlertDescription>
      </Alert>
    );
  }
  if (phase === "tx_submitted" || phase === "tx_confirming") {
    return (
      <Alert variant="info">
        <AlertTitle>Transaction submitted</AlertTitle>
        <AlertDescription className="space-y-1">
          <p>
            Waiting for one block of confirmation on Sepolia (~12 seconds).
            You can close this tab — the transfer will still settle.
          </p>
          {txHash && (
            <a
              href={`${ETHERSCAN_BASE}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-mono text-[11px] uppercase tracking-[0.18em] text-foreground hover:text-primary hover:underline"
            >
              View on Etherscan ↗
            </a>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  // phase === "verifying"
  return (
    <Alert variant="info">
      <AlertTitle>Verifying chain state…</AlertTitle>
      <AlertDescription>
        Transfer confirmed. Reading post-tx contract state.
      </AlertDescription>
    </Alert>
  );
}

function Step({
  index,
  state,
  title,
  description,
  children,
}: {
  index: number;
  state: StepState;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-4 transition-colors",
        state === "current" && "border-primary/40 bg-primary/5",
        state === "done" && "border-emerald-500/40 bg-emerald-500/5",
        state === "idle" && "border-border bg-surface opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]",
            state === "current" && "border-primary text-primary",
            state === "done" &&
              "border-emerald-500 bg-emerald-500/10 text-emerald-300",
            state === "idle" && "border-border text-muted-foreground",
          )}
        >
          {state === "done" ? "✓" : index}
        </div>
        <div className="flex-1 space-y-2">
          <div className="font-mono text-sm font-semibold tracking-tight">
            Step {index} · {title}
          </div>
          <div className="font-mono text-xs leading-relaxed text-muted-foreground">
            {description}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
