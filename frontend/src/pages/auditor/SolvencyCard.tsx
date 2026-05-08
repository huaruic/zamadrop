import { useReadContract } from "wagmi";

import { CAMPAIGN_ABI, ERC20_ABI } from "@/abis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatTokenAmount } from "@/hooks/useTokenMeta";

interface SolvencyCardProps {
  campaignAddress: `0x${string}`;
  tokenAddress: `0x${string}` | undefined;
  declaredTotal: bigint | undefined;
  decimals: number;
  symbol?: string;
}

/** Auditor solvency invariant card.
 *
 * Spec: auditor-verification §"偿付不变式检查".
 * Invariant: balance >= declaredTotal - claimedTotalPlaintext (a.k.a.
 * "still owed"). If the contract holds at least the unclaimed remainder,
 * every recipient can still be paid; otherwise something has gone wrong
 * (admin pulled too much via withdrawExcess, or token was forced out). */
export function SolvencyCard({
  campaignAddress,
  tokenAddress,
  declaredTotal,
  decimals,
  symbol,
}: SolvencyCardProps) {
  const { data: balanceRaw } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [campaignAddress],
    query: { enabled: !!tokenAddress },
  });
  const balance = balanceRaw as bigint | undefined;

  const { data: claimedTotalPtRaw } = useReadContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "claimedTotalPlaintext",
  });
  const claimedTotalPlaintext = claimedTotalPtRaw as bigint | undefined;

  const stillOwed =
    declaredTotal !== undefined && claimedTotalPlaintext !== undefined
      ? declaredTotal - claimedTotalPlaintext
      : undefined;

  const solvent =
    balance !== undefined && stillOwed !== undefined
      ? balance >= stillOwed
      : undefined;

  const shortfall =
    balance !== undefined &&
    stillOwed !== undefined &&
    balance < stillOwed
      ? stillOwed - balance
      : 0n;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Solvency invariant</CardTitle>
        <CardDescription>
          <code>balance &ge; declaredTotal − claimedTotalPlaintext</code>.
          Holds iff the campaign can still pay every unclaimed recipient.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-3">
          <Stat
            label="Balance"
            value={formatTokenAmount(balance, decimals, symbol)}
          />
          <Stat
            label="Declared total"
            value={formatTokenAmount(declaredTotal, decimals, symbol)}
          />
          <Stat
            label="Claimed (plaintext)"
            value={formatTokenAmount(claimedTotalPlaintext, decimals, symbol)}
          />
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-2">
          <Stat
            label="Still owed"
            value={formatTokenAmount(stillOwed, decimals, symbol)}
          />
          <Stat
            label="Headroom"
            value={
              balance !== undefined && stillOwed !== undefined
                ? formatTokenAmount(
                    balance > stillOwed ? balance - stillOwed : 0n,
                    decimals,
                    symbol,
                  )
                : "—"
            }
          />
        </div>

        {solvent === true && (
          <Alert variant="info">
            <AlertTitle>✅ Solvent</AlertTitle>
            <AlertDescription>
              Campaign balance covers every unclaimed allocation.
            </AlertDescription>
          </Alert>
        )}
        {solvent === false && (
          <Alert variant="destructive">
            <AlertTitle>⚠️ INSOLVENT</AlertTitle>
            <AlertDescription>
              Shortfall:{" "}
              <strong>{formatTokenAmount(shortfall, decimals, symbol)}</strong>
              . The campaign cannot fulfil every remaining claim.
            </AlertDescription>
          </Alert>
        )}
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
