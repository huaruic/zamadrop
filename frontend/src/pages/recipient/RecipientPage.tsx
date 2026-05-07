import { useCallback } from "react";
import { useAccount, useReadContract } from "wagmi";

import { CAMPAIGN_ABI, ERC20_ABI } from "@/abis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useCampaignParam } from "@/hooks/useCampaignParam";
import { useCampaignReads } from "@/hooks/useCampaignReads";
import { useTokenMeta } from "@/hooks/useTokenMeta";

import { AllocationCard } from "./AllocationCard";
import { BalancePanel } from "./BalancePanel";
import { ClaimStepper } from "./ClaimStepper";

// V7 state enum (must match contract):
//   0 = Setup, 1 = Finalizing, 2 = Claiming, 3 = Failed
const STATE_FAILED = 3;

/** Recipient role page.
 *
 * UI states keyed off chain reads:
 *   A. Disconnected               → connect prompt
 *   B. Connected, no allocation   → "ask admin" notice
 *   C. Allocation set, !finalized → encrypted card + disabled stepper
 *   D. Finalized, !claimed        → encrypted card + active claim button
 *   F. Transferred                → success state + balance
 *
 * The recipient signs both `claim()` and `executeTransfer()` themselves; the
 * stepper drives an active-pull KMS decrypt + submit between them. See ADR
 * 0001 (KMS-gated callback) and the shared util in
 * `frontend/src/lib/kms-active-pull.ts`. */
export default function RecipientPage() {
  const { campaignAddress } = useCampaignParam();
  const { address, isConnected } = useAccount();

  const { finalized, tokenAddress } = useCampaignReads(campaignAddress);
  const { symbol, decimals } = useTokenMeta(tokenAddress);

  // V7: read the explicit state enum so we can render a Failed message
  // instead of the misleading "not finalized yet" copy when the KMS sum
  // check failed and the campaign is terminally cancelled.
  const { data: stateNumData } = useReadContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "state",
  });
  const stateNum = stateNumData as number | undefined;

  // V7 · in Failed state we want to distinguish "admin already cancelled
  // (balance == 0)" from "admin has not yet called cancelCampaign". Reading
  // the campaign's token balance gives the recipient an honest signal
  // instead of pre-asserting funds were returned.
  const { data: campaignBalanceData } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: campaignAddress ? [campaignAddress] : undefined,
    query: { enabled: stateNum === STATE_FAILED && !!tokenAddress },
  });
  const campaignBalance = campaignBalanceData as bigint | undefined;

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

  // `transferred[me]` is a one-shot read. The stepper signals when it has
  // finished `executeTransfer` via `onClaimMined`, at which point we refetch.
  const { data: transferredData, refetch: refetchTransferred } = useReadContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "transferred",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
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
        <AlertTitle>You are not on this campaign's recipient list</AlertTitle>
        <AlertDescription>
          Wallet {short(address)} has no allocation registered. Ask the admin
          to add you, then reload.
        </AlertDescription>
      </Alert>
    );
  }

  // V7 · campaign in Failed state. Three sub-states based on campaign
  // balance: loading / already-cancelled / awaiting-admin-cancel.
  if (stateNum === STATE_FAILED) {
    if (campaignBalance === undefined) {
      return (
        <Alert variant="muted">
          <AlertTitle>Verifying campaign state…</AlertTitle>
          <AlertDescription />
        </Alert>
      );
    }
    if (campaignBalance === 0n) {
      return (
        <Alert variant="destructive">
          <AlertTitle>Campaign cancelled by admin</AlertTitle>
          <AlertDescription>
            The KMS sum check failed and the admin terminated this campaign.
            Funds have been returned to the admin via <code>cancelCampaign</code>.
          </AlertDescription>
        </Alert>
      );
    }
    return (
      <Alert variant="destructive">
        <AlertTitle>Campaign in Failed state</AlertTitle>
        <AlertDescription>
          The KMS sum check failed (sum of allocations ≠ declaredTotal). The
          admin has not yet called <code>cancelCampaign</code> to recover the
          funds. There is no claim path here — please contact your admin to
          terminate the campaign.
        </AlertDescription>
      </Alert>
    );
  }

  // States C / D / F — top-line status alert.
  const statusAlert = transferred ? (
    <Alert variant="info">
      <AlertTitle>Settlement complete</AlertTitle>
      <AlertDescription>
        Your tokens have been transferred. The amount is now visible on-chain
        via the ERC-20 Transfer event — that's the documented privacy boundary
        (encrypted up to claim, public on settlement).
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
        transferred={transferred}
      />
    </div>
  );
}

function short(addr: `0x${string}`) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
