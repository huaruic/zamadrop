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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ETHERSCAN_BASE } from "@/config";
import { formatTokenAmount, parseTokenAmount } from "@/hooks/useTokenMeta";

import { shortHash } from "./shortAddr";

interface WithdrawExcessFormProps {
  campaignAddress: `0x${string}`;
  tokenAddress: `0x${string}` | undefined;
  declaredTotal: bigint | undefined;
  claimedTotalPlaintext: bigint | undefined;
  decimals: number;
  symbol?: string;
  /** withdrawExcess only works in Claiming. The contract reverts otherwise. */
  enabled: boolean;
  onSuccess: () => void;
}

type Stage = "idle" | "awaiting-wallet" | "mining" | "submitted";

/** V7 admin recovery flow.
 *
 * `withdrawExcess(amount)` is callable while state == Claiming and pulls back
 * any ZDT in the campaign in excess of `declaredTotal - claimedTotalPlaintext`.
 * The contract enforces:
 *   maxWithdraw = balance - (declaredTotal - claimedTotalPlaintext)
 * so this UI can pre-compute the same number to gate the input client-side. */
export function WithdrawExcessForm({
  campaignAddress,
  tokenAddress,
  declaredTotal,
  claimedTotalPlaintext,
  decimals,
  symbol,
  enabled,
  onSuccess,
}: WithdrawExcessFormProps) {
  const [amountInput, setAmountInput] = useState("");
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

  // Run mined-side-effects exactly once per pendingHash. The ref tracks the
  // last tx we already settled so we don't re-trigger refetches across
  // re-renders. Avoiding setState directly in the effect body satisfies
  // react-hooks/set-state-in-effect.
  const settledHashRef = useRef<`0x${string}` | null>(null);
  useEffect(() => {
    if (!isMined || !pendingHash) return;
    if (settledHashRef.current === pendingHash) return;
    settledHashRef.current = pendingHash;
    queueMicrotask(() => {
      setStage("submitted");
      setLastTx(pendingHash);
      setAmountInput("");
      void refetchBalance();
      onSuccess();
      resetWrite();
    });
  }, [isMined, pendingHash, onSuccess, refetchBalance, resetWrite]);

  // Derive the visible stage label from the underlying tx state instead of
  // mirroring it into a useState we'd then have to keep in sync via an
  // effect. This eliminates the "isMining → setStage('mining')" cascade.
  const visibleStage: Stage =
    stage === "submitted"
      ? "submitted"
      : isMining
        ? "mining"
        : stage;

  // Solvency math: stillOwed = declaredTotal - claimedTotalPlaintext.
  // maxWithdraw = balance - stillOwed (clamped at zero).
  const stillOwed =
    declaredTotal !== undefined && claimedTotalPlaintext !== undefined
      ? declaredTotal - claimedTotalPlaintext
      : undefined;
  const maxWithdraw =
    balance !== undefined && stillOwed !== undefined
      ? balance > stillOwed
        ? balance - stillOwed
        : 0n
      : undefined;

  let parsed: bigint | null = null;
  let parseError: string | null = null;
  if (amountInput.length > 0) {
    try {
      parsed = parseTokenAmount(amountInput, decimals);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
  }
  const amountValid =
    parsed !== null &&
    parsed > 0n &&
    maxWithdraw !== undefined &&
    parsed <= maxWithdraw;

  const isBusy =
    visibleStage === "awaiting-wallet" || visibleStage === "mining";
  const submitDisabled = !enabled || isBusy || !amountValid;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitDisabled || parsed === null) return;
    setErrorMsg(null);
    try {
      setStage("awaiting-wallet");
      await writeContractAsync({
        abi: CAMPAIGN_ABI,
        address: campaignAddress,
        functionName: "withdrawExcess",
        args: [parsed],
      });
    } catch (err) {
      setStage("idle");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const stageMessage =
    visibleStage === "awaiting-wallet"
      ? "Awaiting wallet confirmation…"
      : visibleStage === "mining"
        ? "Mining…"
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Withdraw excess</CardTitle>
        <CardDescription>
          Pull back ZDT held by the campaign in excess of what's still owed to
          unclaimed recipients. Only callable while the campaign is{" "}
          <code>Claiming</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-3">
          <Stat
            label="Campaign balance"
            value={formatTokenAmount(balance, decimals, symbol)}
          />
          <Stat
            label="Still owed"
            value={formatTokenAmount(stillOwed, decimals, symbol)}
          />
          <Stat
            label="Max withdraw"
            value={formatTokenAmount(maxWithdraw, decimals, symbol)}
          />
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="withdrawAmount">
              Withdraw amount{symbol ? ` · ${symbol}` : ""}
            </Label>
            <Input
              id="withdrawAmount"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              disabled={!enabled || isBusy}
              spellCheck={false}
              autoComplete="off"
            />
            {parseError && (
              <p className="font-mono text-[11px] text-destructive">
                {parseError}
              </p>
            )}
            {parsed !== null &&
              maxWithdraw !== undefined &&
              parsed > maxWithdraw && (
                <p className="font-mono text-[11px] text-destructive">
                  Exceeds max withdraw (
                  {formatTokenAmount(maxWithdraw, decimals, symbol)}).
                </p>
              )}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" disabled={submitDisabled}>
              Withdraw
            </Button>
            {stageMessage && (
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {stageMessage}
              </span>
            )}
          </div>

          {!enabled && (
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Withdraw is only available once the campaign is in the{" "}
              <code>Claiming</code> state.
            </p>
          )}

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
              <AlertTitle>Withdraw submitted</AlertTitle>
              <AlertDescription>
                Tx{" "}
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
        </form>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-base font-semibold tracking-tight">
        {value}
      </div>
    </div>
  );
}
