import { useReadContract, useReadContracts } from "wagmi";

import { CAMPAIGN_ABI, ERC20_ABI } from "@/abis";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ETHERSCAN_BASE } from "@/config";
import { formatTokenAmount, useTokenMeta } from "@/hooks/useTokenMeta";

interface PublicViewProps {
  campaignAddress: `0x${string}`;
}

/** V7 Public read-only campaign view. Spec: admin-deployment-flow §URL 接管.
 *
 * Renders campaign metadata, the public claim progress bar
 * (claimedTotalPlaintext / declaredTotal) and the state badge. Zero
 * interactive controls — anyone can land on /c/<address> without a wallet
 * and still see what's going on. */
export default function PublicView({ campaignAddress }: PublicViewProps) {
  const { data: reads } = useReadContracts({
    contracts: [
      { address: campaignAddress, abi: CAMPAIGN_ABI, functionName: "admin" },
      { address: campaignAddress, abi: CAMPAIGN_ABI, functionName: "auditor" },
      {
        address: campaignAddress,
        abi: CAMPAIGN_ABI,
        functionName: "declaredTotal",
      },
      {
        address: campaignAddress,
        abi: CAMPAIGN_ABI,
        functionName: "recipientCount",
      },
      { address: campaignAddress, abi: CAMPAIGN_ABI, functionName: "token" },
      { address: campaignAddress, abi: CAMPAIGN_ABI, functionName: "state" },
      {
        address: campaignAddress,
        abi: CAMPAIGN_ABI,
        functionName: "claimedTotalPlaintext",
      },
    ],
  });

  const admin = reads?.[0]?.result as `0x${string}` | undefined;
  const auditor = reads?.[1]?.result as `0x${string}` | undefined;
  const declaredTotal = reads?.[2]?.result as bigint | undefined;
  const recipientCount = reads?.[3]?.result as bigint | undefined;
  const tokenAddress = reads?.[4]?.result as `0x${string}` | undefined;
  const stateNum = reads?.[5]?.result as number | undefined;
  const claimedTotal = reads?.[6]?.result as bigint | undefined;

  const { symbol, decimals } = useTokenMeta(tokenAddress);

  const { data: contractBalanceRaw } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [campaignAddress],
    query: { enabled: !!tokenAddress },
  });
  const contractBalance = contractBalanceRaw as bigint | undefined;

  const stateLabel = describeState(stateNum);
  const stateBadge = stateBadgeVariant(stateNum);

  // Progress is meaningful only after finalization. Before that, declaredTotal
  // exists but no claims have happened yet.
  const progressPct =
    claimedTotal !== undefined && declaredTotal && declaredTotal > 0n
      ? Number((claimedTotal * 10000n) / declaredTotal) / 100
      : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>{shortAddr(campaignAddress)}</CardTitle>
              <CardDescription>
                <a
                  href={`${ETHERSCAN_BASE}/address/${campaignAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  View on Etherscan ↗
                </a>
              </CardDescription>
            </div>
            <Badge variant={stateBadge}>{stateLabel}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
            <Stat
              label="Declared total"
              value={formatTokenAmount(declaredTotal, decimals, symbol)}
            />
            <Stat
              label="Recipients"
              value={
                recipientCount === undefined ? "—" : recipientCount.toString()
              }
            />
            <Stat
              label="Claimed so far"
              value={formatTokenAmount(claimedTotal, decimals, symbol)}
            />
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Claim progress
              </span>
              <span className="font-mono text-xs">
                {progressPct.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-border">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.min(100, progressPct)}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Admin" value={admin} />
            <Field label="Auditor" value={auditor} />
            <Field label="Token" value={tokenAddress} extra={symbol} />
          </div>

          <div className="rounded-md border border-border bg-surface p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Campaign balance
            </div>
            <div className="mt-1 font-mono text-lg font-semibold tracking-tight">
              {formatTokenAmount(contractBalance, decimals, symbol)}
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            ◢ Public view · per-recipient amounts encrypted with FHEVM until
            settlement
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold tracking-tight">
        {value}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  extra,
}: {
  label: string;
  value?: `0x${string}`;
  extra?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-sm">
        {value ? (
          <a
            href={`${ETHERSCAN_BASE}/address/${value}`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-primary hover:underline"
          >
            {shortAddr(value)}
          </a>
        ) : (
          "—"
        )}
        {extra && <span className="ml-2 text-muted-foreground">· {extra}</span>}
      </div>
    </div>
  );
}

function shortAddr(addr?: string): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Map the on-chain `state` enum to a label.
 *  enum State { Setup=0, Finalizing=1, Claiming=2, Failed=3 } */
function describeState(s: number | undefined): string {
  switch (s) {
    case 0:
      return "Setup";
    case 1:
      return "Finalizing";
    case 2:
      return "Claiming";
    case 3:
      return "Failed";
    default:
      return "Loading";
  }
}

function stateBadgeVariant(
  s: number | undefined,
): "default" | "cipher" | "success" | "muted" | "danger" {
  switch (s) {
    case 0:
      return "default";
    case 1:
      return "cipher";
    case 2:
      return "success";
    case 3:
      return "danger";
    default:
      return "muted";
  }
}
