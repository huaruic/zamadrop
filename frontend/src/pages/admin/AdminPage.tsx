import { useCallback } from "react";
import { useAccount } from "wagmi";

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
import { FinalizePanel } from "./FinalizePanel";
import { SetAllocationForm } from "./SetAllocationForm";
import { isZeroHash } from "./shortAddr";

type Phase = "Setup" | "Finalize-pending" | "Claiming" | "Loading";

/** Admin page · ZamaDrop
 *  Boundaries (per docs/role-page-protocol.md §4.2 + docs/security-notes.md §3):
 *   - Reads: declaredTotal, recipientCount, finalized, finalizeCheckHandle, AllocationSet events
 *   - Writes: setAllocation, finalize
 *   - Does NOT call publicDecrypt or callbackFinalize — that is the executor's job. */
export default function AdminPage() {
  const { campaignAddress } = useCampaignParam();
  const { address: walletAddress, isConnected } = useAccount();

  const reads = useCampaignReads(campaignAddress);
  const { symbol, decimals } = useTokenMeta(reads.tokenAddress);
  const events = useAllocationEvents(campaignAddress);

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
  }, [reads, events]);

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

      {isAdmin && (
        <>
          <StatusCard
            phase={phase}
            declaredTotal={reads.declaredTotal}
            decimals={decimals}
            symbol={symbol}
            recipientCount={declaredCount}
            allocationsSetCount={allocationsSetCount}
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
        </>
      )}
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
