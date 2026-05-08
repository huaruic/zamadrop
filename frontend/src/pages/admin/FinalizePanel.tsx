import { useState } from "react";
import { usePublicClient, useWalletClient, useWriteContract } from "wagmi";

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
  pullAndCallbackFinalize,
} from "@/lib/kms-active-pull";

import { shortHash } from "./shortAddr";

interface FinalizePanelProps {
  campaignAddress: `0x${string}`;
  finalized: boolean | undefined;
  hasAllocations: boolean;
  isAdmin: boolean;
  onSuccess: () => void;
}

type Stage =
  | "idle"
  | "awaiting-wallet"
  | "mining"
  | "kms-pulling"
  | "awaiting-wallet-2"
  | "mining-2"
  | "submitted";

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

  const { writeContractAsync } = useWriteContract();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

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

  const isBusy =
    stage === "awaiting-wallet" ||
    stage === "mining" ||
    stage === "kms-pulling" ||
    stage === "awaiting-wallet-2" ||
    stage === "mining-2";
  const submitDisabled = !isAdmin || !hasAllocations || isBusy;

  async function onFinalize() {
    if (submitDisabled) return;
    if (!walletClient || !publicClient) {
      setErrorMsg("Wallet or RPC client not ready. Reconnect and try again.");
      return;
    }
    setErrorMsg(null);
    try {
      // ── Pop 1: finalize() ────────────────────────────────────────
      setStage("awaiting-wallet");
      const finalizeHash = await writeContractAsync({
        abi: CAMPAIGN_ABI,
        address: campaignAddress,
        functionName: "finalize",
        args: [],
      });
      setStage("mining");
      await publicClient.waitForTransactionReceipt({ hash: finalizeHash });

      // ── Active pull + Pop 2: callbackFinalize() ─────────────────
      setStage("kms-pulling");
      const fhevm = await getFhevmInstance();
      const callerAddress = walletClient.account?.address;
      if (!callerAddress) {
        throw new Error("Wallet account address unavailable.");
      }
      // Note: pullAndCallbackFinalize internally triggers Pop 2 via
      // walletClient.writeContract; MetaMask will surface the prompt.
      setStage("awaiting-wallet-2");
      const { result } = await pullAndCallbackFinalize(campaignAddress, {
        walletClient,
        publicClient,
        fhevm,
        callerAddress,
      });
      setStage("mining-2");

      if (!result) {
        setStage("idle");
        setErrorMsg(
          "KMS sum check failed; campaign is in Failed state. Click cancelCampaign in admin view to recover.",
        );
        return;
      }

      setStage("submitted");
      setLastTx(finalizeHash);
      onSuccess();
    } catch (err) {
      setStage("idle");
      if (err instanceof CallbackError && err.kind === "decrypt_failed") {
        setErrorMsg(
          "Gateway publicDecrypt failed after retries. State remains Finalizing on chain. Retry by clicking Finalize again once gateway is responsive.",
        );
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const stageMessage =
    stage === "awaiting-wallet"
      ? "Awaiting wallet confirmation (1/2)…"
      : stage === "mining"
        ? "Mining finalize…"
        : stage === "kms-pulling"
          ? "Pulling KMS-signed result…"
          : stage === "awaiting-wallet-2"
            ? "Awaiting wallet confirmation (2/2)…"
            : stage === "mining-2"
              ? "Mining callback…"
              : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Finalize campaign</CardTitle>
        <CardDescription>
          Submits an FHE equality check, then actively pulls the KMS-signed
          result and submits the callback. Two wallet popups in quick
          succession (~15-20s end-to-end).
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
              Finalize complete. Campaign is now in Claiming state — recipients
              can claim.
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
