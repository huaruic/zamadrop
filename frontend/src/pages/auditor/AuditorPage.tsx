import { useAccount } from "wagmi";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ETHERSCAN_BASE } from "@/config";
import { useCampaignParam } from "@/hooks/useCampaignParam";
import { useCampaignReads } from "@/hooks/useCampaignReads";
import { useTokenMeta } from "@/hooks/useTokenMeta";

import { AggregateCard } from "./AggregateCard";
import { ClaimsActivity } from "./ClaimsActivity";
import { ComplianceCard } from "./ComplianceCard";
import { PerClaimAuditCard } from "./PerClaimAuditCard";
import { RecipientListHashCard } from "./RecipientListHashCard";
import { SolvencyCard } from "./SolvencyCard";

/** V7 Auditor page · spec: auditor-verification capability.
 *
 * Strict read-only view. No mutating chain actions are exposed; every
 * interactive button is either local computation (list-hash recompute,
 * solvency invariant) or a Zama Gateway off-chain decryption (aggregate
 * claimed total). The V6 ComplianceCard + ClaimsActivity stay as-is because
 * they are the privacy-boundary explainer.
 *
 * V7 additions:
 *   - RecipientListHashCard:  re-derive listHash from AllocationSet events
 *   - SolvencyCard:           balance ≥ declaredTotal − claimedTotalPlaintext
 *   - PerClaimAuditCard:      surface KMS proof bytes per executeTransfer tx
 *
 * Three states (preserved from V6):
 *   A. Disconnected            → preview
 *   B. Connected, not auditor  → preview (no aggregate decrypt)
 *   C. Connected as auditor    → full view with aggregate decrypt enabled */
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

  // Verification panels render in BOTH preview and active modes — the V7
  // capability spec is explicit that auditor work is "完全只读" so anyone
  // (auditor or not) can recompute the list hash and check solvency. Only
  // the aggregate decrypt is gated on the auditor role (the contract's
  // FHE.allow grants reside there).
  return (
    <div className="space-y-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Auditor view · {shortAddr(campaignAddress)}
      </div>

      {!isAuditor && (
        <Alert variant="warning">
          <AlertTitle>
            Preview mode · {!isConnected ? "not connected" : "not the auditor"}
          </AlertTitle>
          <AlertDescription>
            {!isConnected ? (
              <>
                Connect a wallet to enable aggregate decryption. List-hash
                verification and the solvency invariant remain available
                read-only.
              </>
            ) : (
              <>
                This wallet does not hold the auditor role for this campaign.
                You can still verify the list hash and solvency invariant
                locally; only the aggregate claimed total is gated. Auditor
                address:{" "}
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
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      <RecipientListHashCard campaignAddress={campaignAddress} />

      <SolvencyCard
        campaignAddress={campaignAddress}
        tokenAddress={tokenAddress}
        declaredTotal={declaredTotal}
        decimals={decimals}
        symbol={symbol}
      />

      <PerClaimAuditCard
        campaignAddress={campaignAddress}
        decimals={decimals}
        symbol={symbol}
      />

      {isAuditor && (
        <AggregateCard
          campaignAddress={campaignAddress}
          declaredTotal={declaredTotal}
          decimals={decimals}
          symbol={symbol}
        />
      )}

      <ComplianceCard />

      {isAuditor && <ClaimsActivity campaignAddress={campaignAddress} />}
    </div>
  );
}

function shortAddr(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
