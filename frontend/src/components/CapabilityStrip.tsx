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

/** Compact "what can I do here" strip on the Overview tab. Answers the
 * question that "Active/Preview" tab labels also answer, but front-loaded so a
 * just-connected wallet doesn't have to point-and-test each tab to learn. */
export function CapabilityStrip({ campaignAddress }: CapabilityStripProps) {
  const { address, isConnected } = useAccount();
  const role = useRoleInfo(address, campaignAddress);

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Your capabilities on this campaign
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          Connect a wallet to see which roles you hold. Until then every role
          tab is preview-only.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Your capabilities on this campaign
      </div>
      <div className="flex flex-wrap gap-2">
        {CAPABILITIES.map((cap) => {
          const active = role[cap.roleKey];
          return (
            <Link
              key={cap.label}
              to={`/campaign/${campaignAddress}/${cap.to}`}
              className={cn(
                "group inline-flex items-center gap-2 rounded-md border px-3 py-1.5 transition-colors",
                active
                  ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
                  : "border-border bg-card hover:border-border/80",
              )}
            >
              <span
                className={cn(
                  "font-mono text-xs",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {cap.label}
              </span>
              <span
                className={cn(
                  "font-mono text-[9px] uppercase tracking-[0.18em]",
                  active ? "text-primary" : "text-muted-foreground/70",
                )}
              >
                {active ? "active" : "preview"}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
