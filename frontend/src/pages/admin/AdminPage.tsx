import { useCallback } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";

import { CAMPAIGN_ABI, ERC20_ABI } from "@/abis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAllocationEvents } from "@/hooks/useCampaignEvents";
import { useCampaignParam } from "@/hooks/useCampaignParam";
import { useCampaignReads } from "@/hooks/useCampaignReads";
import { formatTokenAmount, useTokenMeta } from "@/hooks/useTokenMeta";

import { AllocationLedger } from "./AllocationLedger";
import { CancelCampaignForm } from "./CancelCampaignForm";
import { FinalizePanel } from "./FinalizePanel";
import { SetAllocationForm } from "./SetAllocationForm";
import { isZeroHash } from "./shortAddr";
import { WithdrawExcessForm } from "./WithdrawExcessForm";

type Phase = "Setup" | "Finalize-pending" | "Claiming" | "Loading";

/** Admin page · ZamaDrop
 *  Boundaries (per docs/role-page-protocol.md §4.2 + docs/security-notes.md §3):
 *   - Reads: declaredTotal, recipientCount, finalized, finalizeCheckHandle, AllocationSet events
 *   - Writes: setAllocation, finalize
 *   - Calls publicDecrypt + callbackFinalize via the active-pull util in FinalizePanel. */
export default function AdminPage() {
  const { campaignAddress } = useCampaignParam();
  const { address: walletAddress, isConnected } = useAccount();

  const reads = useCampaignReads(campaignAddress);
  const { symbol, decimals } = useTokenMeta(reads.tokenAddress);
  const events = useAllocationEvents(campaignAddress);

  // V7-only reads: state enum, claimedTotalPlaintext, recipientListHash.
  const { data: v7Reads, refetch: refetchV7 } = useReadContracts({
    contracts: [
      { address: campaignAddress, abi: CAMPAIGN_ABI, functionName: "state" },
      {
        address: campaignAddress,
        abi: CAMPAIGN_ABI,
        functionName: "claimedTotalPlaintext",
      },
      {
        address: campaignAddress,
        abi: CAMPAIGN_ABI,
        functionName: "recipientListHash",
      },
    ],
  });
  const stateNum = v7Reads?.[0]?.result as number | undefined;
  const claimedTotalPlaintext = v7Reads?.[1]?.result as bigint | undefined;
  const recipientListHash = v7Reads?.[2]?.result as `0x${string}` | undefined;

  const { data: contractBalanceRaw, refetch: refetchBalance } = useReadContract(
    {
      address: reads.tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [campaignAddress],
      query: { enabled: !!reads.tokenAddress },
    },
  );
  const contractBalance = contractBalanceRaw as bigint | undefined;

  const isAdmin =
    !!walletAddress &&
    !!reads.admin &&
    walletAddress.toLowerCase() === reads.admin.toLowerCase();

  const allocationsSetCount = events.data?.length ?? 0;
  const declaredCount =
    reads.recipientCount === undefined
      ? "—"
      : reads.recipientCount.toString();

  const phase: Phase = derivePhase(reads.finalized, reads.finalizeCheckHandle);

  const refetchAll = useCallback(() => {
    reads.refetch();
    events.refetch();
    void refetchV7();
    void refetchBalance();
  }, [reads, events, refetchV7, refetchBalance]);

  // V6 + post-Codex refinement: hide operational data sections in preview
  // mode. Disconnected or non-admin wallets see only the guard alert. Public
  // campaign state stays visible on the Overview tab.
  return (
    <div className="space-y-6">
      <GuardBanner
        isConnected={isConnected}
        isAdmin={isAdmin}
        adminLoaded={!!reads.admin}
      />

      {isAdmin && stateNum === 3 && (
        <>
          <StatusCard
            phase={phase}
            declaredTotal={reads.declaredTotal}
            decimals={decimals}
            symbol={symbol}
            recipientCount={declaredCount}
            allocationsSetCount={allocationsSetCount}
          />

          <V7BadgeStrip
            claimedTotalPlaintext={claimedTotalPlaintext}
            contractBalance={contractBalance}
            recipientListHash={recipientListHash}
            decimals={decimals}
            symbol={symbol}
          />

          <CancelCampaignForm
            campaignAddress={campaignAddress}
            tokenAddress={reads.tokenAddress}
            decimals={decimals}
            symbol={symbol}
            enabled={stateNum === 3}
            onSuccess={refetchAll}
          />
        </>
      )}

      {isAdmin && stateNum !== 3 && (
        <>
          <StatusCard
            phase={phase}
            declaredTotal={reads.declaredTotal}
            decimals={decimals}
            symbol={symbol}
            recipientCount={declaredCount}
            allocationsSetCount={allocationsSetCount}
          />

          <V7BadgeStrip
            claimedTotalPlaintext={claimedTotalPlaintext}
            contractBalance={contractBalance}
            recipientListHash={recipientListHash}
            decimals={decimals}
            symbol={symbol}
          />

          <SetAllocationForm
            campaignAddress={campaignAddress}
            decimals={decimals}
            symbol={symbol}
            disabled={phase !== "Setup"}
            disabledReason={
              phase !== "Setup"
                ? "Allocations are locked once finalize is submitted."
                : undefined
            }
            onSuccess={refetchAll}
          />

          <AllocationLedger campaignAddress={campaignAddress} />

          {phase !== "Claiming" && (
            <FinalizePanel
              campaignAddress={campaignAddress}
              finalized={reads.finalized}
              hasAllocations={allocationsSetCount > 0}
              isAdmin={isAdmin}
              onSuccess={refetchAll}
            />
          )}

          {phase === "Claiming" && (
            <Alert variant="info">
              <AlertTitle>Campaign live for claims</AlertTitle>
              <AlertDescription>
                Finalize settled — recipients can now claim.
              </AlertDescription>
            </Alert>
          )}

          <WithdrawExcessForm
            campaignAddress={campaignAddress}
            tokenAddress={reads.tokenAddress}
            declaredTotal={reads.declaredTotal}
            claimedTotalPlaintext={claimedTotalPlaintext}
            decimals={decimals}
            symbol={symbol}
            // V7 contract gate: state == Claiming (enum 2). Other states
            // would revert NotClaiming, so disable the form preemptively.
            enabled={stateNum === 2}
            onSuccess={refetchAll}
          />
        </>
      )}
    </div>
  );
}

/** V7 badge strip: surface the three new public reads (claimedTotalPlaintext,
 * balanceOf, recipientListHash) so admins have at-a-glance solvency + list
 * integrity signal without leaving this page. */
function V7BadgeStrip({
  claimedTotalPlaintext,
  contractBalance,
  recipientListHash,
  decimals,
  symbol,
}: {
  claimedTotalPlaintext: bigint | undefined;
  contractBalance: bigint | undefined;
  recipientListHash: `0x${string}` | undefined;
  decimals: number;
  symbol?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>V7 invariants</CardTitle>
        <CardDescription>
          Public solvency + list-integrity reads. Auditor-grade visibility for
          admins.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <BadgeCell
            label="Claimed total (plaintext)"
            value={formatTokenAmount(claimedTotalPlaintext, decimals, symbol)}
          />
          <BadgeCell
            label="Campaign balance"
            value={formatTokenAmount(contractBalance, decimals, symbol)}
          />
          <BadgeCell
            label="Recipient list hash"
            value={
              recipientListHash
                ? `${recipientListHash.slice(0, 10)}…${recipientListHash.slice(-6)}`
                : "—"
            }
            title={recipientListHash}
            mono
          />
        </div>
      </CardContent>
    </Card>
  );
}

function BadgeCell({
  label,
  value,
  title,
  mono,
}: {
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
}) {
  return (
    <div
      className="rounded-md border border-border bg-surface p-4"
      title={title}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 font-semibold tracking-tight ${mono ? "font-mono text-xs break-all" : "font-mono text-base"}`}
      >
        {value}
      </div>
    </div>
  );
}

function derivePhase(
  finalized: boolean | undefined,
  finalizeCheckHandle: `0x${string}` | undefined,
): Phase {
  if (finalized === undefined) return "Loading";
  if (finalized === true) return "Claiming";
  return isZeroHash(finalizeCheckHandle) ? "Setup" : "Finalize-pending";
}

function GuardBanner({
  isConnected,
  isAdmin,
  adminLoaded,
}: {
  isConnected: boolean;
  isAdmin: boolean;
  adminLoaded: boolean;
}) {
  if (!isConnected) {
    return (
      <Alert variant="warning">
        <AlertTitle>Preview mode · not connected</AlertTitle>
        <AlertDescription>
          Connect a wallet to see whether you can act here. Until then this is
          a read-only walkthrough of the admin workflow.
        </AlertDescription>
      </Alert>
    );
  }
  if (adminLoaded && !isAdmin) {
    return (
      <Alert variant="warning">
        <AlertTitle>Preview mode · not the admin</AlertTitle>
        <AlertDescription>
          This wallet can inspect the admin workflow but cannot submit
          transactions. Only the campaign admin can set allocations or
          finalize.
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

function StatusCard({
  phase,
  declaredTotal,
  decimals,
  symbol,
  recipientCount,
  allocationsSetCount,
}: {
  phase: Phase;
  declaredTotal: bigint | undefined;
  decimals: number;
  symbol?: string;
  recipientCount: string;
  allocationsSetCount: number;
}) {
  const phaseVariant: "default" | "cipher" | "success" | "muted" =
    phase === "Setup"
      ? "default"
      : phase === "Finalize-pending"
        ? "cipher"
        : phase === "Claiming"
          ? "success"
          : "muted";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Campaign status</CardTitle>
            <CardDescription>
              Public state of this ZamaDrop campaign.
            </CardDescription>
          </div>
          <Badge variant={phaseVariant}>{phase}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
          <Stat
            label="Declared total"
            value={formatTokenAmount(declaredTotal, decimals, symbol)}
          />
          <Stat label="Recipients" value={recipientCount} />
          <Stat
            label="Allocations set"
            value={`${allocationsSetCount} / ${recipientCount}`}
          />
        </div>

        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Running total stays encrypted.
        </p>
      </CardContent>
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
