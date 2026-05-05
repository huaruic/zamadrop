import { useAccount, useReadContract, useReadContracts } from "wagmi";

import { CAMPAIGN_ABI, ERC20_ABI } from "@/abis";
import { ETHERSCAN_BASE } from "@/config";
import { useRoleInfo } from "@/useRoleInfo";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface CampaignCardProps {
  address: `0x${string}`;
}

export function CampaignCard({ address: campaignAddress }: CampaignCardProps) {
  const { address: walletAddress, isConnected } = useAccount();

  const { data: campaignReads, isLoading } = useReadContracts({
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
      {
        address: campaignAddress,
        abi: CAMPAIGN_ABI,
        functionName: "finalized",
      },
      { address: campaignAddress, abi: CAMPAIGN_ABI, functionName: "token" },
      {
        address: campaignAddress,
        abi: CAMPAIGN_ABI,
        functionName: "finalizeCheckHandle",
      },
    ],
  });

  const admin = campaignReads?.[0]?.result as `0x${string}` | undefined;
  const auditor = campaignReads?.[1]?.result as `0x${string}` | undefined;
  const declaredTotal = campaignReads?.[2]?.result as bigint | undefined;
  const recipientCount = campaignReads?.[3]?.result as bigint | undefined;
  const finalized = campaignReads?.[4]?.result as boolean | undefined;
  const tokenAddress = campaignReads?.[5]?.result as
    | `0x${string}`
    | undefined;
  const finalizeCheckHandle = campaignReads?.[6]?.result as
    | `0x${string}`
    | undefined;

  const phase = derivePhase(finalized, finalizeCheckHandle);

  const { data: tokenSymbol } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "symbol",
    query: { enabled: !!tokenAddress },
  });

  const { data: tokenDecimalsRaw } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "decimals",
    query: { enabled: !!tokenAddress },
  });

  const tokenDecimals = (tokenDecimalsRaw as number | undefined) ?? 0;

  const role = useRoleInfo(walletAddress, campaignAddress);

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{shortAddr(campaignAddress)}</CardTitle>
            <CardDescription>
              <a
                href={`${ETHERSCAN_BASE}/address/${campaignAddress}`}
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground hover:underline"
              >
                View on Etherscan ↗
              </a>
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant={phaseBadgeVariant(phase)}>
              {isLoading ? "Loading" : phase}
            </Badge>
            {isConnected &&
              (role.roleLabels.length > 0 ? (
                <Badge variant="cipher">
                  You · {role.roleLabels.join(" / ")}
                </Badge>
              ) : (
                <Badge variant="muted">No role</Badge>
              ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
          <Stat
            label="Declared total"
            value={formatTokenAmount(declaredTotal, tokenDecimals, tokenSymbol)}
          />
          <Stat
            label="Recipients"
            value={recipientCount === undefined ? "—" : recipientCount.toString()}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Admin" value={admin} />
          <Field label="Auditor" value={auditor} />
        </div>

        <Field label="Token" value={tokenAddress} extra={tokenSymbol} />
      </CardContent>

      <CardFooter>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          ◢ Per-recipient amounts encrypted with FHEVM
        </p>
      </CardFooter>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tracking-tight">
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

function shortAddr(addr?: `0x${string}`) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatTokenAmount(
  amount: bigint | undefined,
  decimals: number,
  symbol?: string,
) {
  if (amount === undefined) return "—";
  const div = 10n ** BigInt(decimals);
  const whole = amount / div;
  const formatted = whole.toLocaleString("en-US");
  return symbol ? `${formatted} ${symbol}` : formatted;
}

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

type Phase = "Setup" | "Finalize-pending" | "Claiming" | "Loading";

/** Mirrors AdminPage.derivePhase — keeps Overview + Admin badge wording in
 * sync. Setup = no finalize requested; Finalize-pending = handle emitted but
 * executor hasn't settled callback; Claiming = finalized=true. */
function derivePhase(
  finalized: boolean | undefined,
  finalizeCheckHandle: `0x${string}` | undefined,
): Phase {
  if (finalized === undefined) return "Loading";
  if (finalized === true) return "Claiming";
  return !finalizeCheckHandle || finalizeCheckHandle === ZERO_HASH
    ? "Setup"
    : "Finalize-pending";
}

function phaseBadgeVariant(
  phase: Phase,
): "default" | "cipher" | "success" | "muted" {
  switch (phase) {
    case "Setup":
      return "default";
    case "Finalize-pending":
      return "cipher";
    case "Claiming":
      return "success";
    case "Loading":
      return "muted";
  }
}
