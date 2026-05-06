import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, useReadContract } from "wagmi";
import { isAddress } from "viem";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONTRACTS } from "@/config";

import { useWizardStore } from "./state";

/** Step 3 — Auditor + auto-derived budget panel.
 *
 * Spec: admin-deployment-flow §"Step 3 — 自动派生预算面板"
 *
 *   - The ONLY editable field is the auditor address.
 *   - declaredTotal and recipientCount are derived from the Step-2 list and
 *     SHALL NOT be editable. We render them as read-only cards.
 *   - We surface largest/smallest recipient as quick sanity signals.
 */

const TOKEN_ADDRESS = ((): `0x${string}` => {
  const env = import.meta.env.VITE_TOKEN_ADDRESS as `0x${string}` | undefined;
  return env ?? CONTRACTS.token;
})();

export default function Step3Auditor() {
  const navigate = useNavigate();
  const { address: walletAddress } = useAccount();

  const recipients = useWizardStore((s) => s.recipients);
  const auditor = useWizardStore((s) => s.auditor);
  const setAuditor = useWizardStore((s) => s.setAuditor);
  const setStep = useWizardStore((s) => s.setStep);

  const { data: balanceRaw } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress },
  });
  const balance = balanceRaw as bigint | undefined;

  const derived = useMemo(() => {
    if (recipients.length === 0) {
      return {
        count: 0,
        sum: 0n,
        largest: null as null | { address: string; amount: bigint },
        smallest: null as null | { address: string; amount: bigint },
      };
    }
    let sum = 0n;
    let largest = recipients[0];
    let smallest = recipients[0];
    for (const r of recipients) {
      sum += r.amount;
      if (r.amount > largest.amount) largest = r;
      if (r.amount < smallest.amount) smallest = r;
    }
    return {
      count: recipients.length,
      sum,
      largest: { address: largest.address, amount: largest.amount },
      smallest: { address: smallest.address, amount: smallest.amount },
    };
  }, [recipients]);

  const auditorValid =
    typeof auditor === "string" && auditor.length > 0 && isAddress(auditor);
  const sufficient = balance !== undefined && balance >= derived.sum;

  const canProceed = auditorValid && recipients.length > 0;

  const handleNext = () => {
    if (!canProceed) return;
    setStep(4);
    void navigate("/wizard/review");
  };

  return (
    <div className="space-y-4">
      {recipients.length === 0 && (
        <Alert variant="warning">
          <AlertTitle>No recipients yet</AlertTitle>
          <AlertDescription>
            Go back to Step 2 and add at least one recipient before continuing.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Auditor</CardTitle>
          <CardDescription>
            The auditor address can read-only verify the campaign on chain. It
            is set immutably at deploy time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label htmlFor="auditor">Auditor address</Label>
            <Input
              id="auditor"
              placeholder="0x…"
              value={auditor}
              onChange={(e) =>
                setAuditor((e.target.value || "") as `0x${string}` | "")
              }
              spellCheck={false}
              autoComplete="off"
            />
            {auditor.length > 0 && !auditorValid && (
              <p className="font-mono text-[11px] text-destructive">
                Invalid address (expected 0x + 40 hex chars).
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Budget · auto-derived</CardTitle>
          <CardDescription>
            Read-only preview. Derived from your Step-2 list.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Cell label="Recipient count" value={derived.count.toString()} />
            <Cell
              label="Declared total"
              value={`${derived.sum.toString()} ZDT`}
            />
            <Cell
              label="Largest recipient"
              value={
                derived.largest
                  ? `${derived.largest.amount.toString()} ZDT`
                  : "—"
              }
              title={derived.largest?.address}
            />
            <Cell
              label="Smallest recipient"
              value={
                derived.smallest
                  ? `${derived.smallest.amount.toString()} ZDT`
                  : "—"
              }
              title={derived.smallest?.address}
            />
          </div>

          <div className="rounded-md border border-border bg-surface p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Wallet balance vs declared total
            </div>
            <div className="mt-1 font-mono text-sm">
              {balance === undefined
                ? "Loading…"
                : `${balance.toString()} ZDT (${
                    sufficient ? "sufficient" : "insufficient"
                  })`}
            </div>
            {!sufficient && balance !== undefined && (
              <p className="mt-1 font-mono text-[11px] text-destructive">
                Wallet balance is below the declared total. Top up before
                deploy or reduce the list.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setStep(2);
            void navigate("/wizard/recipients");
          }}
        >
          Back
        </Button>
        <Button onClick={handleNext} disabled={!canProceed}>
          Next · Review
        </Button>
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div
      className="rounded-md border border-border bg-surface p-3"
      title={title}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-semibold tracking-tight">
        {value}
      </div>
    </div>
  );
}
