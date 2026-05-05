import { useEffect, useState } from "react";
import {
  useWaitForTransactionReceipt,
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
import { cn } from "@/lib/utils";

import { shortHandle } from "./shorten";

type StepState = "idle" | "current" | "done";

interface ClaimStepperProps {
  campaignAddress: `0x${string}`;
  finalized: boolean;
  claimed: boolean;
  transferred: boolean;
  pendingHandle?: `0x${string}`;
  /** Called when the claim transaction is mined; parent should refetch chain reads. */
  onClaimMined: () => void;
}

const ZERO_HANDLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Three-step stepper that walks the recipient through claim → settlement → done.
 *
 * Per role-page-protocol §4.3 boundary, this component DOES NOT call
 * publicDecrypt or executeTransfer — that is the off-chain executor's
 * responsibility. We only submit `claim()` and then display the pending handle
 * while the parent polls `transferred[me]`. */
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
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);

  const { isLoading: isClaimMining, isSuccess: claimMined } =
    useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (claimMined) onClaimMined();
  }, [claimMined, onClaimMined]);

  const handleClaim = async () => {
    try {
      const hash = await writeContractAsync({
        address: campaignAddress,
        abi: CAMPAIGN_ABI,
        functionName: "claim",
      });
      setTxHash(hash);
    } catch {
      // surfaced via writeError
    }
  };

  // Step state derivation. Step 3 is a terminal state — once `transferred`
  // flips, it goes straight to `done` (green ✓), not `current` (yellow active).
  const step1: StepState = claimed ? "done" : finalized ? "current" : "idle";
  const step2: StepState = transferred
    ? "done"
    : claimed
      ? "current"
      : "idle";
  const step3: StepState = transferred ? "done" : "idle";

  const settledHandle =
    pendingHandle && pendingHandle !== ZERO_HANDLE ? pendingHandle : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claim & withdraw</CardTitle>
        <CardDescription>
          Three steps. You only sign step 1 — the rest happens automatically.
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
                : "Submit a transaction to lock in your claim. The amount stays encrypted until the executor settles it."
          }
        >
          {step1 === "current" && (
            <div className="space-y-3">
              <Button
                onClick={handleClaim}
                disabled={isSubmitting || isClaimMining}
              >
                {isSubmitting
                  ? "Awaiting wallet…"
                  : isClaimMining
                    ? "Confirming…"
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
          title={step2 === "done" ? "Settlement complete" : "Awaiting settlement"}
          description={
            step2 === "done"
              ? "Executor decrypted via KMS and pushed the ERC-20 transfer."
              : step2 === "current"
                ? "The off-chain executor reads this handle, decrypts it via KMS, and submits the ERC-20 transfer. Typically settles in ~30 seconds."
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
              <Alert variant="warning">
                <AlertTitle>Hands-off</AlertTitle>
                <AlertDescription>
                  No further action from you. We poll every 5 seconds for the
                  settlement event.
                </AlertDescription>
              </Alert>
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
