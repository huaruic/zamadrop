import { useEffect, useState } from "react";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

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
import { shortHash } from "./shortAddr";

interface FinalizePanelProps {
  campaignAddress: `0x${string}`;
  finalized: boolean | undefined;
  hasAllocations: boolean;
  isAdmin: boolean;
  onSuccess: () => void;
}

type Stage = "idle" | "awaiting-wallet" | "mining" | "submitted";

export function FinalizePanel({
  campaignAddress,
  finalized,
  hasAllocations,
  isAdmin,
  onSuccess,
}: FinalizePanelProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<`0x${string}` | null>(null);

  const { writeContractAsync, data: pendingHash, reset: resetWrite } =
    useWriteContract();
  const { isLoading: isMining, isSuccess: isMined } =
    useWaitForTransactionReceipt({ hash: pendingHash });

  useEffect(() => {
    if (isMining && stage === "awaiting-wallet") setStage("mining");
  }, [isMining, stage]);

  useEffect(() => {
    if (!isMined || !pendingHash) return;
    setStage("submitted");
    setLastTx(pendingHash);
    onSuccess();
    resetWrite();
  }, [isMined, pendingHash, onSuccess, resetWrite]);

  // Once finalize is complete (campaign-side), suppress the panel.
  if (finalized) {
    return (
      <Alert variant="info">
        <AlertTitle>Campaign live</AlertTitle>
        <AlertDescription>
          Finalization settled — recipients can claim.
        </AlertDescription>
      </Alert>
    );
  }

  const isBusy = stage === "awaiting-wallet" || stage === "mining";
  const submitDisabled = !isAdmin || !hasAllocations || isBusy;

  async function onFinalize() {
    if (submitDisabled) return;
    setErrorMsg(null);
    try {
      setStage("awaiting-wallet");
      await writeContractAsync({
        abi: CAMPAIGN_ABI,
        address: campaignAddress,
        functionName: "finalize",
        args: [],
      });
    } catch (err) {
      setStage("idle");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const stageMessage =
    stage === "awaiting-wallet"
      ? "Awaiting wallet confirmation…"
      : stage === "mining"
        ? "Mining…"
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Finalize campaign</CardTitle>
        <CardDescription>
          Submits an FHE equality check between the encrypted running total and
          the declared total. The off-chain executor settles the result via KMS.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="lg"
            onClick={onFinalize}
            disabled={submitDisabled}
          >
            Finalize campaign
          </Button>
          {stageMessage && (
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {stageMessage}
            </span>
          )}
        </div>

        {!isAdmin && (
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Admin wallet required.
          </p>
        )}

        {isAdmin && !hasAllocations && (
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Set at least one allocation before finalizing.
          </p>
        )}

        {stage === "submitted" && (
          <Alert variant="info">
            <AlertTitle>Finalize submitted</AlertTitle>
            <AlertDescription>
              Submitted. Off-chain executor will settle the equality check via
              KMS — campaign auto-advances to Claiming.
              {lastTx && (
                <>
                  {" · "}
                  <a
                    href={`${ETHERSCAN_BASE}/tx/${lastTx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground hover:text-primary hover:underline"
                  >
                    {shortHash(lastTx)}
                  </a>
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        {errorMsg && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="break-words">
              {errorMsg}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
