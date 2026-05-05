import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { useAccount } from "wagmi";

import { Badge } from "@/components/ui/badge";
import { useRoleInfo } from "@/useRoleInfo";
import { cn } from "@/lib/utils";

interface TabDef {
  to: string;
  label: string;
  end?: boolean;
  /** Universal tab — no Active/Preview suffix; everyone can see. */
  publicView?: boolean;
  /** Which role grants Active state on this tab (vs Preview for non-role wallets). */
  roleKey?: "isAdmin" | "isRecipient" | "isAuditor";
}

const TABS: readonly TabDef[] = [
  { to: "", label: "Overview", end: true, publicView: true },
  { to: "admin", label: "Admin", roleKey: "isAdmin" },
  { to: "me", label: "Recipient", roleKey: "isRecipient" },
  { to: "audit", label: "Auditor", roleKey: "isAuditor" },
];

export default function CampaignLayout() {
  const { address: campaignAddressParam } = useParams();
  const campaignAddress = campaignAddressParam as `0x${string}` | undefined;

  const { address: walletAddress, isConnected } = useAccount();
  const role = useRoleInfo(walletAddress, campaignAddress);

  if (!campaignAddress) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
        <p className="font-mono text-sm text-muted-foreground">
          Missing campaign address in URL.
        </p>
      </div>
    );
  }

  return (
    <>
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
      >
        ← Campaigns
      </Link>

      <header className="mb-6 space-y-1.5">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight md:text-3xl">
            {shortAddr(campaignAddress)}
          </h1>
          {isConnected && role.roleLabels.length > 0 && (
            <Badge variant="cipher">You · {role.roleLabels.join(" / ")}</Badge>
          )}
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Campaign detail · capability views
        </p>
      </header>

      <nav className="mb-8 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((tab) => {
          const hasRole = tab.roleKey ? role[tab.roleKey] : false;
          // Active = you have the role for this tab. Preview = you don't.
          // Suffix only renders on role-gated tabs (not on Overview).
          return (
            <NavLink
              key={tab.label}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "relative px-4 py-2.5 transition-colors",
                  isActive
                    ? "text-primary"
                    : tab.publicView
                      ? "text-foreground hover:text-primary"
                      : hasRole
                        ? "text-foreground hover:text-primary"
                        : "text-muted-foreground/60 hover:text-muted-foreground",
                )
              }
            >
              {({ isActive }) => (
                <span className="inline-flex items-baseline gap-2">
                  <span className="font-mono text-xs uppercase tracking-[0.2em]">
                    {tab.label}
                  </span>
                  {!tab.publicView && (
                    <span
                      className={cn(
                        "font-mono text-[9px] uppercase tracking-[0.18em]",
                        hasRole ? "text-primary" : "text-muted-foreground/70",
                      )}
                    >
                      · {hasRole ? "active" : "preview"}
                    </span>
                  )}
                  {isActive && (
                    <span className="absolute inset-x-0 -bottom-px h-px bg-primary" />
                  )}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <Outlet context={{ campaignAddress }} />
    </>
  );
}

function shortAddr(addr: `0x${string}`) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
