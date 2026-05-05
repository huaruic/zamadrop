import { Link } from "react-router-dom";

import { CampaignCard } from "@/components/CampaignCard";
import { CAMPAIGNS } from "@/config";

export default function PublicHome() {
  return (
    <>
      <header className="mb-8 space-y-1.5">
        <h1 className="font-mono text-2xl font-semibold tracking-tight md:text-3xl">
          Campaigns
        </h1>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Public ledger · encrypted allocations
        </p>
      </header>

      {CAMPAIGNS.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {CAMPAIGNS.map((address) => (
            <Link
              key={address}
              to={`/campaign/${address}`}
              className="group block transition hover:-translate-y-0.5"
            >
              <CampaignCard address={address} />
              <div className="mt-3 text-right font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground transition group-hover:text-primary">
                Enter campaign →
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
      <p className="font-mono text-sm text-muted-foreground">
        No campaigns deployed yet.
      </p>
    </div>
  );
}
