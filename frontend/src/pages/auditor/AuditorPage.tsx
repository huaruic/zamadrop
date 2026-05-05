import { useAccount } from "wagmi";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ETHERSCAN_BASE } from "@/config";
import { useCampaignParam } from "@/hooks/useCampaignParam";
import { useCampaignReads } from "@/hooks/useCampaignReads";
import { useTokenMeta } from "@/hooks/useTokenMeta";

import { AggregateCard } from "./AggregateCard";
import { ClaimsActivity } from "./ClaimsActivity";
import { ComplianceCard } from "./ComplianceCard";

/** Auditor page · spec: docs/role-page-protocol.md §4.4
 *
 * V6 design: preview mode renders the same workflow surface as the active
 * mode, minus the encrypted aggregate decrypt (that read reverts NotAuditor
 * for non-auditor wallets and would surface an error for no real reason).
 * The compliance explainer + claim activity feed remain visible because they
 * ARE the compliance proof — every visitor should see what the auditor can
 * and cannot decrypt without holding the role.
 *
 * Three states:
 *   A. Disconnected            → preview alert + ComplianceCard + ClaimsActivity
 *   B. Connected, not auditor  → preview alert + ComplianceCard + ClaimsActivity
 *   C. Connected as auditor    → full view (aggregate + compliance + activity) */
export default function AuditorPage() {
  const { campaignAddress } = useCampaignParam();
  const { address, isConnected } = useAccount();
  const { auditor, declaredTotal, tokenAddress } =
    useCampaignReads(campaignAddress);
  const { symbol, decimals } = useTokenMeta(tokenAddress);

  const isAuditor =
    isConnected &&
    !!address &&
    !!auditor &&
    address.toLowerCase() === auditor.toLowerCase();

  // Preview mode (states A + B): keep ComplianceCard visible so the FHE
  // privacy boundary stays inspectable without the wallet (compliance demo).
  // Hide AggregateCard (role-gated read) and ClaimsActivity (role-specific
  // operational ledger).
  if (!isAuditor) {
    return (
      <div className="space-y-6">
        {!isConnected ? (
          <Alert variant="warning">
            <AlertTitle>Preview mode · not connected</AlertTitle>
            <AlertDescription>
              Connect a wallet to see whether you can decrypt the aggregate.
              Until then this is a read-only walkthrough of what the auditor
              sees.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="warning">
            <AlertTitle>Preview mode · not the auditor</AlertTitle>
            <AlertDescription>
              This wallet does not hold the auditor role for this campaign.
              You can inspect the auditor workflow but cannot decrypt the
              aggregate. Auditor address:{" "}
              {auditor ? (
                <a
                  href={`${ETHERSCAN_BASE}/address/${auditor}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cipher hover:underline"
                >
                  {shortAddr(auditor)}
                </a>
              ) : (
                "—"
              )}
              .
            </AlertDescription>
          </Alert>
        )}

        <ComplianceCard />
      </div>
    );
  }

  // Active mode (state C): connected wallet IS the auditor.
  return (
    <div className="space-y-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Auditor view · {shortAddr(campaignAddress)}
      </div>

      <AggregateCard
        campaignAddress={campaignAddress}
        declaredTotal={declaredTotal}
        decimals={decimals}
        symbol={symbol}
      />

      <ComplianceCard />

      <ClaimsActivity campaignAddress={campaignAddress} />
    </div>
  );
}

function shortAddr(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
