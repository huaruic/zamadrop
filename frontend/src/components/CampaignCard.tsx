import { Link } from "react-router-dom";
import { useAccount, useReadContract, useReadContracts } from "wagmi";

import { CAMPAIGN_ABI, ERC20_ABI } from "@/abis";
import { ETHERSCAN_BASE } from "@/config";
import type { BackendCampaign } from "@/hooks/useCampaignList";
import {
  derivePhase,
  phaseBadgeVariant,
  phaseFromBackendState,
  phaseLabel,
} from "@/lib/phase";
import { useRoleInfo } from "@/useRoleInfo";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface CampaignCardProps {
  address: `0x${string}`;
  backendData?: BackendCampaign | null;
  onConnect?: () => void;
}

export function CampaignCard({
  address: campaignAddress,
  backendData,
  onConnect,
}: CampaignCardProps) {
  const { address: walletAddress, isConnected } = useAccount();

  const useChainFallback = !backendData;

  const { data: campaignReads, isLoading: chainLoading } = useReadContracts({
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
    query: { enabled: useChainFallback },
  });

  const chainAdmin = campaignReads?.[0]?.result as `0x${string}` | undefined;
  const chainAuditor = campaignReads?.[1]?.result as `0x${string}` | undefined;
  const chainDeclaredTotal = campaignReads?.[2]?.result as bigint | undefined;
  const chainRecipientCount = campaignReads?.[3]?.result as bigint | undefined;
  const chainFinalized = campaignReads?.[4]?.result as boolean | undefined;
  const chainTokenAddress = campaignReads?.[5]?.result as
    | `0x${string}`
    | undefined;
  const chainFinalizeCheckHandle = campaignReads?.[6]?.result as
    | `0x${string}`
    | undefined;

  const admin = backendData
    ? (backendData.admin as `0x${string}`)
    : chainAdmin;
  const auditor = backendData
    ? (backendData.auditor as `0x${string}`)
    : chainAuditor;
  const declaredTotal = backendData
    ? safeBigint(backendData.declaredTotal)
    : chainDeclaredTotal;
  const recipientCount = backendData
    ? BigInt(backendData.recipientCount)
    : chainRecipientCount;
  const tokenAddress = backendData
    ? (backendData.token as `0x${string}`)
    : chainTokenAddress;

  const phase = backendData
    ? phaseFromBackendState(backendData.state)
    : derivePhase(chainFinalized, chainFinalizeCheckHandle);

  const isLoading = useChainFallback ? chainLoading : false;

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

  const titleText =
    backendData?.name && backendData.name.trim().length > 0
      ? backendData.name
      : shortAddr(campaignAddress);
  const description =
    backendData?.description && backendData.description.trim().length > 0
      ? backendData.description
      : null;

  return (
    <Link
      to={`/campaign/${campaignAddress}`}
      className="group block transition hover:-translate-y-0.5"
    >
      <Card className="overflow-hidden">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={phaseBadgeVariant(phase)}>
              {isLoading ? "Loading" : phaseLabel(phase)}
            </Badge>
            <Badge variant="cipher">FHE-encrypted</Badge>
          </div>
          <div className="space-y-1">
            <div className="font-mono text-base font-semibold tracking-tight">
              {titleText}
            </div>
            {backendData?.name && (
              <div className="font-mono text-[11px] text-muted-foreground">
                {shortAddr(campaignAddress)}
              </div>
            )}
            {description && (
              <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <MetricPill
              label="Declared total"
              value={formatTokenAmount(
                declaredTotal,
                tokenDecimals,
                tokenSymbol,
              )}
            />
            <MetricPill
              label="Recipients"
              value={
                recipientCount === undefined
                  ? "—"
                  : recipientCount.toString()
              }
            />
          </div>

          <YourRoleRow
            isConnected={isConnected}
            roleLabels={role.roleLabels}
            onConnect={onConnect}
          />

          <SecondaryFields
            admin={admin}
            auditor={auditor}
            tokenAddress={tokenAddress}
            tokenSymbol={tokenSymbol}
          />
        </CardContent>
      </Card>
    </Link>
  );
}

function YourRoleRow({
  isConnected,
  roleLabels,
  onConnect,
}: {
  isConnected: boolean;
  roleLabels: string[];
  onConnect?: () => void;
}) {
  if (!isConnected) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onConnect?.();
        }}
        className="inline-flex items-center"
      >
        <Badge variant="outline" className="cursor-pointer hover:bg-surface">
          Your role · Connect wallet to see your role
        </Badge>
      </button>
    );
  }
  if (roleLabels.length === 0) {
    return (
      <Badge variant="muted">Your role · Not involved</Badge>
    );
  }
  return (
    <Badge variant="cipher">Your role · {roleLabels.join(" · ")}</Badge>
  );
}

function SecondaryFields({
  admin,
  auditor,
  tokenAddress,
  tokenSymbol,
}: {
  admin?: `0x${string}`;
  auditor?: `0x${string}`;
  tokenAddress?: `0x${string}`;
  tokenSymbol?: unknown;
}) {
  const tokenDisplay = (() => {
    if (!tokenAddress) return null;
    return typeof tokenSymbol === "string" && tokenSymbol.length > 0
      ? tokenSymbol
      : shortAddr(tokenAddress);
  })();

  return (
    <p className="border-t border-border/60 pt-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
      {admin && (
        <SecondaryLink
          label="Created by"
          value={admin}
          display={shortAddr(admin)}
        />
      )}
      {auditor && (
        <>
          <span className="px-1">·</span>
          <SecondaryLink
            label="Auditor"
            value={auditor}
            display={shortAddr(auditor)}
          />
        </>
      )}
      {tokenAddress && tokenDisplay && (
        <>
          <span className="px-1">·</span>
          <SecondaryLink
            label="Token"
            value={tokenAddress}
            display={tokenDisplay}
          />
        </>
      )}
    </p>
  );
}

function SecondaryLink({
  label,
  value,
  display,
}: {
  label: string;
  value: `0x${string}`;
  display: string;
}) {
  return (
    <span>
      <span>{label} </span>
      <a
        href={`${ETHERSCAN_BASE}/address/${value}`}
        target="_blank"
        rel="noreferrer"
        title={value}
        onClick={(event) => event.stopPropagation()}
        className="hover:text-foreground hover:underline"
      >
        {display}
      </a>
    </span>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-semibold tracking-tight">
        {value}
      </div>
    </div>
  );
}

function shortAddr(addr?: `0x${string}`) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function safeBigint(value: string): bigint | undefined {
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function formatTokenAmount(
  amount: bigint | undefined,
  decimals: number,
  symbol?: unknown,
) {
  if (amount === undefined) return "—";
  const div = 10n ** BigInt(decimals);
  const whole = amount / div;
  const formatted = whole.toLocaleString("en-US");
  const symbolStr = typeof symbol === "string" ? symbol : "";
  return symbolStr ? `${formatted} ${symbolStr}` : formatted;
}
