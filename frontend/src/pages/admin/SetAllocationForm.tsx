import { useEffect, useState } from "react";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ETHERSCAN_BASE } from "@/config";
import { encryptUint64 } from "@/fhevm";
import { parseTokenAmount } from "@/hooks/useTokenMeta";
import { shortHash } from "./shortAddr";

type Stage = "idle" | "encrypting" | "awaiting-wallet" | "mining" | "done";

interface SetAllocationFormProps {
  campaignAddress: `0x${string}`;
  decimals: number;
  symbol?: string;
  disabled: boolean;
  disabledReason?: string;
  onSuccess: () => void;
}

export function SetAllocationForm({
  campaignAddress,
  decimals,
  symbol,
  disabled,
  disabledReason,
  onSuccess,
}: SetAllocationFormProps) {
  const { address: walletAddress } = useAccount();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<`0x${string}` | null>(null);

  const { writeContractAsync, data: pendingHash, reset: resetWrite } =
    useWriteContract();
  const { isLoading: isMining, isSuccess: isMined } =
    useWaitForTransactionReceipt({ hash: pendingHash });

  // When tx mined, finalize state, clear form, notify parent.
  useEffect(() => {
    if (!isMined || !pendingHash) return;
    setStage("done");
    setLastTx(pendingHash);
    setRecipient("");
    setAmount("");
    onSuccess();
    resetWrite();
    // Drop the "done" badge after a beat so subsequent submits feel fresh.
    const t = setTimeout(() => setStage("idle"), 4000);
    return () => clearTimeout(t);
  }, [isMined, pendingHash, onSuccess, resetWrite]);

  // Track mining stage transition.
  useEffect(() => {
    if (isMining && stage === "awaiting-wallet") setStage("mining");
  }, [isMining, stage]);

  const recipientValid =
    /^0x[a-fA-F0-9]{40}$/.test(recipient.trim());

  // Strict bigint parsing — `Number(amount)` loses precision above 2^53 and
  // silently accepts "5e3" / "  5  ". parseTokenAmount throws on malformed
  // input, so we wrap it in try/catch and surface the parse error to the user
  // when they actually submit.
  let amountParsed: bigint | null = null;
  let amountParseError: string | null = null;
  if (amount.length > 0) {
    try {
      amountParsed = parseTokenAmount(amount, decimals);
    } catch (err) {
      amountParseError = err instanceof Error ? err.message : String(err);
    }
  }
  const amountValid = amountParsed !== null && amountParsed > 0n;

  const isBusy =
    stage === "encrypting" ||
    stage === "awaiting-wallet" ||
    stage === "mining";

  const submitDisabled =
    disabled || isBusy || !recipientValid || !amountValid || !walletAddress;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitDisabled || !walletAddress || amountParsed === null) return;
    setErrorMsg(null);
    try {
      setStage("encrypting");
      const { handle, proof } = await encryptUint64(
        campaignAddress,
        walletAddress,
        amountParsed,
      );
      setStage("awaiting-wallet");
      await writeContractAsync({
        abi: CAMPAIGN_ABI,
        address: campaignAddress,
        functionName: "setAllocation",
        args: [recipient.trim() as `0x${string}`, handle, proof],
      });
      // Stage will move to "mining" via effect, then "done" after receipt.
    } catch (err) {
      setStage("idle");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const stageMessage =
    stage === "encrypting"
      ? "Encrypting…"
      : stage === "awaiting-wallet"
        ? "Awaiting wallet confirmation…"
        : stage === "mining"
          ? "Mining…"
          : stage === "done"
            ? "✓ Set"
            : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set Allocation</CardTitle>
        <CardDescription>
          Encrypt the amount in-browser, submit it on-chain. Each recipient may
          only be set once.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="recipient">Recipient address</Label>
            <Input
              id="recipient"
              placeholder="0x…"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={disabled || isBusy}
              spellCheck={false}
              autoComplete="off"
            />
            {recipient.length > 0 && !recipientValid && (
              <p className="font-mono text-[11px] text-destructive">
                Invalid address (expected 0x + 40 hex chars).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount">
              Amount{symbol ? ` · ${symbol}` : ""}
            </Label>
            <Input
              id="amount"
              type="number"
              step="any"
              min="0"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={disabled || isBusy}
            />
            {amountParseError && (
              <p className="font-mono text-[11px] text-destructive">
                {amountParseError}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" disabled={submitDisabled}>
              Set allocation
            </Button>
            {stageMessage && (
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {stageMessage}
              </span>
            )}
          </div>

          {disabled && disabledReason && (
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {disabledReason}
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

          {lastTx && stage !== "encrypting" && stage !== "awaiting-wallet" && (
            <p className="font-mono text-[11px] text-muted-foreground">
              Last tx ·{" "}
              <a
                href={`${ETHERSCAN_BASE}/tx/${lastTx}`}
                target="_blank"
                rel="noreferrer"
                className="text-foreground hover:text-primary hover:underline"
              >
                {shortHash(lastTx)}
              </a>
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
