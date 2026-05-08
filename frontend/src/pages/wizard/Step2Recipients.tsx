import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, useReadContract } from "wagmi";

import { ERC20_ABI } from "@/abis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { CONTRACTS } from "@/config";
import { cn } from "@/lib/utils";

import { useWizardStore } from "./state";
import { parseRecipientList, validateListL2 } from "./validators";

/** Step 2 — Recipients.
 *
 * Spec: admin-deployment-flow §"Step 2 — Recipients 与 L1+L2 校验"
 *
 *   L1 (per-line, real-time): address well-formed, amount strict-uint64, > 0
 *   L2 (whole list, gate to Step 3): non-empty, sum > 0, sum ≤ admin balance,
 *                                    no duplicate addresses
 *
 * On Next, we commit the parsed list to the store and call `bumpVersion` to
 * invalidate any prior Step-4 snapshot, per the cascade spec.
 *
 * ENS handling: structurally rejected at L1 in the MVP. The validator emits a
 * clear "ENS not yet supported" error so the user can convert to a 0x
 * address. Full live ENS resolution (`publicClient.getEnsAddress`) is
 * deferred — see commit message of this change for rationale.
 */

const TOKEN_ADDRESS = ((): `0x${string}` => {
  const env = import.meta.env.VITE_TOKEN_ADDRESS as `0x${string}` | undefined;
  return env ?? CONTRACTS.token;
})();

export default function Step2Recipients() {
  const navigate = useNavigate();
  const { address: walletAddress } = useAccount();

  const recipientsInStore = useWizardStore((s) => s.recipients);
  const setRecipients = useWizardStore((s) => s.setRecipients);
  const bumpVersion = useWizardStore((s) => s.bumpVersion);
  const setStep = useWizardStore((s) => s.setStep);

  // Hydrate textarea from the store on first mount so back-navigation
  // preserves user input.
  const [blob, setBlob] = useState<string>(() =>
    recipientsInStore.length === 0
      ? ""
      : recipientsInStore
          .map((r) => `${r.displayInput} ${r.amount.toString()}`)
          .join("\n"),
  );

  const { data: balanceRaw } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress },
  });
  const balance = balanceRaw as bigint | undefined;

  const { recipients, lineIssues } = useMemo(
    () => parseRecipientList(blob),
    [blob],
  );

  const listIssues = useMemo(
    () => validateListL2(recipients, balance),
    [recipients, balance],
  );

  const sum = useMemo(
    () => recipients.reduce((acc, r) => acc + r.amount, 0n),
    [recipients],
  );

  const hasErrorIssue =
    lineIssues.some((i) => i.issue.level === "error") ||
    listIssues.some((i) => i.level === "error");

  const balanceOk = balance !== undefined && sum <= balance;

  const handleNext = () => {
    if (hasErrorIssue) return;
    if (recipients.length === 0) return;
    if (!balanceOk) return;
    setRecipients(recipients);
    bumpVersion();
    setStep(3);
    void navigate("/wizard/auditor");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Recipients</CardTitle>
          <CardDescription>
            One recipient per line, format <code>0xADDRESS AMOUNT</code>. ZDT
            decimals = 0, so amounts are plain integers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="recipients">Recipient list</Label>
            <textarea
              id="recipients"
              value={blob}
              onChange={(e) => setBlob(e.target.value)}
              placeholder={
                "0x1234567890abcdef1234567890abcdef12345678 1000\n" +
                "0xabcdef1234567890abcdef1234567890abcdef12 500"
              }
              spellCheck={false}
              autoComplete="off"
              className="min-h-[200px] w-full rounded-md border border-border bg-surface p-3 font-mono text-xs"
            />
          </div>

          <Summary
            recipientCount={recipients.length}
            sum={sum}
            balance={balance}
          />

          {lineIssues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Line errors</CardTitle>
                <CardDescription>
                  Fix each highlighted line, then Next will enable.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 font-mono text-[11px]">
                  {lineIssues.map((li, i) => (
                    <li
                      key={i}
                      className={cn(
                        li.issue.level === "error"
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      Line {li.lineNumber}: {li.issue.message}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {listIssues.length > 0 && (
            <ListIssuesPanel issues={listIssues} />
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setStep(1);
            void navigate("/wizard/basics");
          }}
        >
          Back
        </Button>
        <Button
          onClick={handleNext}
          disabled={hasErrorIssue || recipients.length === 0 || !balanceOk}
        >
          Next · Auditor
        </Button>
      </div>
    </div>
  );
}

function Summary({
  recipientCount,
  sum,
  balance,
}: {
  recipientCount: number;
  sum: bigint;
  balance: bigint | undefined;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Cell label="Recipients" value={recipientCount.toString()} />
      <Cell label="Total" value={`${sum.toString()} ZDT`} />
      <Cell
        label="Wallet balance"
        value={balance === undefined ? "Loading…" : `${balance.toString()} ZDT`}
      />
    </div>
  );
}

function ListIssuesPanel({ issues }: { issues: { level: string; message: string }[] }) {
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  return (
    <div className="space-y-2">
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>List errors</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc">
              {errors.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert variant="warning">
          <AlertTitle>Warnings</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc">
              {warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-semibold tracking-tight">
        {value}
      </div>
    </div>
  );
}
