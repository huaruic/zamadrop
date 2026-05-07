import { useState } from "react";
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
import { getFhevmInstance } from "@/fhevm";
import {
  CallbackError,
  pullAndExecuteTransfer,
} from "@/lib/kms-active-pull";
import { cn } from "@/lib/utils";

import { shortHandle } from "./shorten";

type StepState = "idle" | "current" | "done";
type SettlePhase = "idle" | "decrypting" | "submitting" | "done";

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
}: ClaimStepperProps) {
  const { writeContractAsync, isPending: isSubmitting, error: writeError } =
    useWriteContract();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [settlePhase, setSettlePhase] = useState<SettlePhase>("idle");
  const [settleError, setSettleError] = useState<string | null>(null);

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
      await publicClient.waitForTransactionReceipt({ hash: claimHash });
      onClaimMined();

      if (!walletClient) throw new Error("Wallet client unavailable.");
      const account = walletClient.account;
      if (!account) throw new Error("No wallet account connected.");

      // Step 2: pull KMS decryption + submit executeTransfer — recipient
      // signs the second wallet popup.
      setSettlePhase("decrypting");
      const fhevm = await getFhevmInstance();
      // Note: pullAndExecuteTransfer prompts the wallet for executeTransfer
      // immediately after the Gateway returns; we flip to "submitting" right
      // before delegating so the UI text reflects the second popup.
      setSettlePhase("submitting");
      await pullAndExecuteTransfer(campaignAddress, account.address, {
        walletClient,
        publicClient,
        fhevm,
        callerAddress: account.address,
      });
      setSettlePhase("done");
      onClaimMined();
    } catch (err) {
      if (err instanceof CallbackError) {
        if (err.kind === "decrypt_failed") {
          setSettleError(
            `${err.message} You can retry by clicking Claim again once the gateway is healthy.`,
          );
        } else {
          setSettleError(
            `${err.message} The transfer transaction failed — contact the campaign admin if this persists.`,
          );
        }
      } else {
        setSettleError(err instanceof Error ? err.message : String(err));
      }
      setSettlePhase("idle");
    }
  };

  // Step state derivation.
  const step1: StepState = claimed ? "done" : finalized ? "current" : "idle";
  const step2: StepState = transferred
    ? "done"
    : claimed
      ? "current"
      : "idle";
  const step3: StepState = transferred ? "done" : "idle";

  const settledHandle =
    pendingHandle && pendingHandle !== ZERO_HANDLE ? pendingHandle : undefined;

  const settling =
    settlePhase === "decrypting" || settlePhase === "submitting";
  const claimButtonDisabled = isSubmitting || settling;

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
                  : settling
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
              {settlePhase === "decrypting" && (
                <Alert variant="info">
                  <AlertTitle>Decrypting amount via KMS…</AlertTitle>
                  <AlertDescription>
                    Asking the Gateway to run threshold MPC. ~3–10 seconds.
                  </AlertDescription>
                </Alert>
              )}
              {settlePhase === "submitting" && (
                <Alert variant="info">
                  <AlertTitle>Submitting transfer…</AlertTitle>
                  <AlertDescription>
                    Sign the second wallet popup to push the ERC-20 transfer.
                  </AlertDescription>
                </Alert>
              )}
              {settleError && (
                <Alert variant="destructive">
                  <AlertTitle>Settlement failed</AlertTitle>
                  <AlertDescription>{settleError}</AlertDescription>
                </Alert>
              )}
            </div>
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
