import { CampaignCard } from "@/components/CampaignCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCampaignList } from "@/hooks/useCampaignList";

export default function PublicHome() {
  const { items, source, isLoading, error, refetch } = useCampaignList();

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

      {source === "fallback" && (
        <Alert variant="muted" className="mb-6">
          <AlertTitle>Backend directory unavailable</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Showing locally-cached campaigns
              {error ? ` · ${error.message}` : ""}.
            </span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isLoading && items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
          <p className="font-mono text-sm text-muted-foreground">
            Loading campaigns from backend…
          </p>
        </div>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {items.map((item) => (
            <CampaignCard
              key={item.address}
              address={item.address}
              backendData={item.backend}
            />
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
