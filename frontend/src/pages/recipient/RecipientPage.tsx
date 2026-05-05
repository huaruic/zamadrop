import { useCallback } from "react";
import { useAccount, useReadContract } from "wagmi";

import { CAMPAIGN_ABI } from "@/abis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useCampaignParam } from "@/hooks/useCampaignParam";
import { useCampaignReads } from "@/hooks/useCampaignReads";
import { useTokenMeta } from "@/hooks/useTokenMeta";

import { AllocationCard } from "./AllocationCard";
import { BalancePanel } from "./BalancePanel";
import { ClaimStepper } from "./ClaimStepper";

/** Recipient role page · spec: docs/role-page-protocol.md §4.3
 *
 * Five UI states keyed off chain reads:
 *   A. Disconnected               → connect prompt
 *   B. Connected, no allocation   → "ask admin" notice
 *   C. Allocation set, !finalized → encrypted card + disabled stepper
 *   D. Finalized, !claimed        → encrypted card + active claim button
 *   E. Claimed, !transferred      → awaiting-settlement state, polls every 5s
 *   F. Transferred                → success state + balance
 *
 * Strict boundary: this page never calls publicDecrypt or executeTransfer —
 * those belong to the off-chain executor. See docs/security-notes.md §3. */
export default function RecipientPage() {
  const { campaignAddress } = useCampaignParam();
  const { address, isConnected } = useAccount();

  const { finalized, tokenAddress } = useCampaignReads(campaignAddress);
  const { symbol, decimals } = useTokenMeta(tokenAddress);

  // Per-recipient flags. All gated on a connected account.
  const {
    data: allocationSetData,
    refetch: refetchAllocationSet,
  } = useReadContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "allocationSet",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: claimedData, refetch: refetchClaimed } = useReadContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "claimed",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const claimed = claimedData === true;

  // Poll `transferred[me]` every 5s while we're in state E (claimed but not yet
  // transferred). The callback form of refetchInterval reads the latest cached
  // value so we can stop polling automatically when the flag flips.
  const { data: transferredData, refetch: refetchTransferred } = useReadContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "transferred",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: (query) => {
        if (!claimed) return false;
        return query.state.data === true ? false : 5000;
      },
    },
  });

  const transferred = transferredData === true;

  const { data: pendingHandleData } = useReadContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "pendingClaimHandle",
    args: address ? [address] : undefined,
    query: { enabled: !!address && claimed && !transferred },
  });

  const allocationSet = allocationSetData === true;
  const isFinalized = finalized === true;

  // Refresh the per-recipient state after a successful claim tx.
  const handleClaimMined = useCallback(() => {
    void refetchAllocationSet();
    void refetchClaimed();
    void refetchTransferred();
  }, [refetchAllocationSet, refetchClaimed, refetchTransferred]);

  // ─────────────────────────────────────────────
  // State A · disconnected
  // ─────────────────────────────────────────────
  if (!isConnected || !address) {
    return (
      <Alert variant="info">
        <AlertTitle>Connect your wallet</AlertTitle>
        <AlertDescription>
          Connect the wallet your allocation was assigned to. Your encrypted
          amount will appear here once the admin has registered you.
        </AlertDescription>
      </Alert>
    );
  }

  // ─────────────────────────────────────────────
  // State B · connected but no allocation
  // V6 + post-Codex: no operational data in preview. Just the alert.
  // ─────────────────────────────────────────────
  if (allocationSetData !== undefined && !allocationSet) {
    return (
      <Alert variant="muted">
        <AlertTitle>Preview mode · no allocation</AlertTitle>
        <AlertDescription>
          This wallet ({short(address)}) is not registered for this campaign.
          Ask the admin to add you, then reload. Until then there's nothing to
          claim from here — your wallet's token balance is on the Overview tab.
        </AlertDescription>
      </Alert>
    );
  }

  // States C / D / E / F — top-line status alert.
  const statusAlert = transferred ? (
    <Alert variant="info">
      <AlertTitle>Settlement complete</AlertTitle>
      <AlertDescription>
        Your tokens have been transferred. The amount is now visible on-chain
        via the ERC-20 Transfer event — that's the documented privacy boundary
        (encrypted up to claim, public on settlement).
      </AlertDescription>
    </Alert>
  ) : claimed ? (
    <Alert variant="warning">
      <AlertTitle>Awaiting settlement</AlertTitle>
      <AlertDescription>
        You've claimed. The off-chain executor is now decrypting your amount via
        KMS and submitting the ERC-20 transfer. Typically ~30 seconds.
      </AlertDescription>
    </Alert>
  ) : isFinalized ? (
    <Alert variant="info">
      <AlertTitle>Ready to claim</AlertTitle>
      <AlertDescription>
        The campaign is finalized. Decrypt to preview your amount, then claim
        when you're ready.
      </AlertDescription>
    </Alert>
  ) : (
    <Alert variant="muted">
      <AlertTitle>Allocation registered</AlertTitle>
      <AlertDescription>
        You have an encrypted allocation. Claim opens once the admin finalizes
        the campaign.
      </AlertDescription>
    </Alert>
  );

  return (
    <div className="space-y-6">
      {statusAlert}

      <AllocationCard
        campaignAddress={campaignAddress}
        account={address}
        decimals={decimals}
        symbol={symbol}
        transferred={transferred}
      />

      <ClaimStepper
        campaignAddress={campaignAddress}
        finalized={isFinalized}
        claimed={claimed}
        transferred={transferred}
        pendingHandle={pendingHandleData as `0x${string}` | undefined}
        onClaimMined={handleClaimMined}
      />

      <BalancePanel
        tokenAddress={tokenAddress}
        account={address}
        decimals={decimals}
        symbol={symbol}
      />
    </div>
  );
}

function short(addr: `0x${string}`) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
