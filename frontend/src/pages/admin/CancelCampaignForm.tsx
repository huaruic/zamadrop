import { useEffect, useRef, useState } from "react";
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { CAMPAIGN_ABI, ERC20_ABI } from "@/abis";
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
import { formatTokenAmount } from "@/hooks/useTokenMeta";

import { shortHash } from "./shortAddr";

interface CancelCampaignFormProps {
  campaignAddress: `0x${string}`;
  tokenAddress: `0x${string}` | undefined;
  decimals: number;
  symbol?: string;
  /** cancelCampaign only works in Failed (state == 3). Other states revert. */
  enabled: boolean;
  onSuccess: () => void;
}

type Stage = "idle" | "awaiting-wallet" | "mining" | "submitted";

/** V7 admin recovery flow for the terminal Failed state.
 *
 * `cancelCampaign()` is only callable while state == Failed (KMS reported a
 * sum mismatch on finalize). It transfers the contract's full ZDT balance
 * back to admin so a fresh campaign can be deployed with corrected inputs. */
export function CancelCampaignForm({
  campaignAddress,
  tokenAddress,
  decimals,
  symbol,
  enabled,
  onSuccess,
}: CancelCampaignFormProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<`0x${string}` | null>(null);

  const { data: balanceRaw, refetch: refetchBalance } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [campaignAddress],
    query: { enabled: !!tokenAddress },
  });
  const balance = balanceRaw as bigint | undefined;

  const { writeContractAsync, data: pendingHash, reset: resetWrite } =
    useWriteContract();
  const { isLoading: isMining, isSuccess: isMined } =
    useWaitForTransactionReceipt({ hash: pendingHash });

  // Run mined-side-effects exactly once per pendingHash. Mirror of the
  // pattern in WithdrawExcessForm to satisfy react-hooks/set-state-in-effect.
  const settledHashRef = useRef<`0x${string}` | null>(null);
  useEffect(() => {
    if (!isMined || !pendingHash) return;
    if (settledHashRef.current === pendingHash) return;
    settledHashRef.current = pendingHash;
    queueMicrotask(() => {
      setStage("submitted");
      setLastTx(pendingHash);
      void refetchBalance();
      onSuccess();
      resetWrite();
    });
  }, [isMined, pendingHash, onSuccess, refetchBalance, resetWrite]);

  const visibleStage: Stage =
    stage === "submitted" ? "submitted" : isMining ? "mining" : stage;

  const isBusy =
    visibleStage === "awaiting-wallet" || visibleStage === "mining";
  const alreadyRecovered = balance !== undefined && balance === 0n;
  const submitDisabled = !enabled || isBusy || alreadyRecovered;

  async function onCancel() {
    if (submitDisabled) return;
    setErrorMsg(null);
    try {
      setStage("awaiting-wallet");
      await writeContractAsync({
        abi: CAMPAIGN_ABI,
        address: campaignAddress,
        functionName: "cancelCampaign",
        args: [],
      });
    } catch (err) {
      setStage("idle");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const buttonLabel =
    visibleStage === "awaiting-wallet"
      ? "Awaiting wallet…"
      : visibleStage === "mining"
        ? "Confirming…"
        : "Cancel campaign and recover funds";

  const balanceText = formatTokenAmount(balance, decimals, symbol);

  return (
    <Card className="border-destructive/60">
      <CardHeader>
        <CardTitle>Cancel campaign and recover funds</CardTitle>
        <CardDescription>
          KMS sum mismatch — declaredTotal ≠ sum of allocations. The campaign
          is terminal. Click to return all funds to your admin wallet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border bg-card p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Recoverable balance
          </div>
          <div className="mt-1 font-mono text-base font-semibold tracking-tight">
            {balance === undefined ? "Loading…" : balanceText}
          </div>
        </div>

        {alreadyRecovered ? (
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Funds already recovered.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            This will call <code>cancelCampaign</code> and transfer{" "}
            <span className="font-mono">{balanceText}</span> back to the admin
            wallet. The campaign will remain in <code>Failed</code> state; deploy
            a new campaign with corrected amounts.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            type="button"
            variant="destructive"
            onClick={onCancel}
            disabled={submitDisabled}
          >
            {buttonLabel}
          </Button>
        </div>

        {errorMsg && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="break-words">
              {errorMsg}
            </AlertDescription>
          </Alert>
        )}

        {visibleStage === "submitted" && lastTx && (
          <Alert variant="info">
            <AlertTitle>Cancellation submitted</AlertTitle>
            <AlertDescription>
              Funds returned to admin wallet. Tx{" "}
              <a
                href={`${ETHERSCAN_BASE}/tx/${lastTx}`}
                target="_blank"
                rel="noreferrer"
                className="text-foreground hover:text-primary hover:underline"
              >
                {shortHash(lastTx)}
              </a>
              .
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
