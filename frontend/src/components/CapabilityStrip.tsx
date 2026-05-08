import { Link } from "react-router-dom";
import { useAccount } from "wagmi";

import { useRoleInfo } from "@/useRoleInfo";
import { cn } from "@/lib/utils";

interface CapabilityStripProps {
  campaignAddress: `0x${string}`;
}

const CAPABILITIES = [
  { label: "Admin", to: "admin", roleKey: "isAdmin" as const },
  { label: "Recipient", to: "me", roleKey: "isRecipient" as const },
  { label: "Auditor", to: "audit", roleKey: "isAuditor" as const },
];

/** Compact "what can I do here" strip on the Overview tab.
 *
 * Only shows role cards the connected wallet actually holds. Unconnected
 * visitors stay in the public overview flow. */
export function CapabilityStrip({ campaignAddress }: CapabilityStripProps) {
  const { address, isConnected } = useAccount();
  const role = useRoleInfo(address, campaignAddress);
  const ownedCapabilities = CAPABILITIES.filter((cap) => role[cap.roleKey]);

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Campaign access
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          Connect a wallet to reveal any Admin, Recipient, or Auditor access on
          this campaign. Until then you are viewing the public overview.
        </p>
      </div>
    );
  }

  if (ownedCapabilities.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Campaign access
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          This wallet has no special role on this campaign. You can still use
          the public overview above to monitor campaign status.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Your role access on this campaign
      </div>
      <div className="flex flex-wrap gap-2">
        {ownedCapabilities.map((cap) => {
          return (
            <Link
              key={cap.label}
              to={`/campaign/${campaignAddress}/${cap.to}`}
              className={cn(
                "group inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 transition-colors hover:bg-primary/10",
              )}
            >
              <span className="font-mono text-xs text-foreground">
                {cap.label}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-primary">
                Go to
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
