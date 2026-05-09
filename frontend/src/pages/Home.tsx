import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount } from "wagmi";

import { CampaignCard } from "@/components/CampaignCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  type CampaignListItem,
  useCampaignList,
} from "@/hooks/useCampaignList";
import {
  type DirectoryPhase,
  type StatusFilter,
  matchesFilter,
  phaseFromBackendState,
} from "@/lib/phase";
import { useConnectWallet } from "@/lib/use-connect-wallet";

const DIRECTORY_ID = "campaign-directory";

type PendingAction = "deploy" | null;
type SortOption = "recent" | "largest" | "recipients" | "address";

interface DirectoryItem {
  address: `0x${string}`;
  phase: DirectoryPhase;
  declaredTotal?: bigint;
  recipientCount?: bigint;
  createdAt?: string;
  backend: CampaignListItem["backend"];
}

export default function Home() {
  const navigate = useNavigate();
  const { isConnected } = useAccount();
  const { connectWallet, error: connectError } = useConnectWallet();
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("recent");

  const {
    items: campaignItems,
    source,
    isLoading,
    error,
    refetch,
  } = useCampaignList();

  useEffect(() => {
    if (!pendingAction || !isConnected) return;
    navigate("/wizard");
    const clear = setTimeout(() => setPendingAction(null), 0);
    return () => clearTimeout(clear);
  }, [isConnected, navigate, pendingAction]);

  useEffect(() => {
    if (!pendingAction || !connectError) return;
    const clear = setTimeout(() => setPendingAction(null), 0);
    return () => clearTimeout(clear);
  }, [connectError, pendingAction]);

  const directoryItems: DirectoryItem[] = campaignItems.map((item) => {
    if (item.backend) {
      return {
        address: item.address,
        phase: phaseFromBackendState(item.backend.state),
        declaredTotal: safeBigint(item.backend.declaredTotal),
        recipientCount: BigInt(item.backend.recipientCount),
        createdAt: item.backend.createdAt,
        backend: item.backend,
      };
    }
    return {
      address: item.address,
      phase: "Loading",
      backend: null,
    };
  });

  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = directoryItems
    .filter((item) => {
      if (
        normalizedQuery &&
        !item.address.toLowerCase().includes(normalizedQuery) &&
        !nameMatches(item.backend?.name, normalizedQuery)
      ) {
        return false;
      }
      if (!matchesFilter(item.phase, statusFilter)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      if (sortBy === "largest") {
        return compareBigInt(right.declaredTotal, left.declaredTotal);
      }
      if (sortBy === "recipients") {
        return compareBigInt(right.recipientCount, left.recipientCount);
      }
      if (sortBy === "address") {
        return left.address.localeCompare(right.address);
      }
      if (left.createdAt && right.createdAt) {
        return right.createdAt.localeCompare(left.createdAt);
      }
      return directoryItems.findIndex((item) => item.address === left.address) -
        directoryItems.findIndex((item) => item.address === right.address);
    });

  const isAllEmpty = !isLoading && directoryItems.length === 0;
  const isFilterEmpty = !isAllEmpty && filteredItems.length === 0;

  const startCampaign = () => {
    if (isConnected) {
      navigate("/wizard");
      return;
    }
    setPendingAction("deploy");
    connectWallet();
  };

  const browseCampaigns = () => {
    document.getElementById(DIRECTORY_ID)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setSortBy("recent");
  };

  return (
    <div className="space-y-8">
      <Card className="gradient-card border-primary/20 shadow-card">
        <CardHeader className="space-y-3">
          <CardTitle className="text-3xl md:text-4xl">Campaigns</CardTitle>
          <CardDescription className="max-w-3xl font-mono text-sm leading-relaxed text-muted-foreground">
            Confidential token distribution on Zama fhEVM. Encrypted
            allocations, on-chain sum check, role-scoped decryption.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button onClick={startCampaign}>Create campaign</Button>
          <Button variant="outline" onClick={browseCampaigns}>
            Browse campaigns
          </Button>
          {pendingAction && !isConnected && !connectError && (
            <Alert variant="muted" className="mt-3 w-full">
              <AlertTitle>Connect your wallet</AlertTitle>
              <AlertDescription>
                Approve the connection request in your wallet to continue.
              </AlertDescription>
            </Alert>
          )}
          {connectError && (
            <Alert variant="muted" className="mt-3 w-full">
              <AlertTitle>Wallet connection note</AlertTitle>
              <AlertDescription>{connectError.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <section id={DIRECTORY_ID} className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-mono text-lg font-semibold tracking-tight">
              Campaigns
            </h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {filteredItems.length} shown · {directoryItems.length} total
            </p>
          </div>
        </header>

        {source === "fallback" && (
          <Alert variant="muted">
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

        <Card className="border-border/80 bg-card/80">
          <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1.2fr)_180px_180px]">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or campaign address"
            />
            <FilterSelect
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
            >
              <option value="all">All</option>
              <option value="live">Live</option>
              <option value="closed">Closed</option>
            </FilterSelect>
            <FilterSelect
              value={sortBy}
              onChange={(event) =>
                setSortBy(event.target.value as SortOption)
              }
            >
              <option value="recent">Most recent</option>
              <option value="largest">Largest declared total</option>
              <option value="recipients">Most recipients</option>
              <option value="address">Address</option>
            </FilterSelect>
          </CardContent>
        </Card>

        {isLoading && directoryItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
            <p className="font-mono text-sm text-muted-foreground">
              Loading campaigns from backend…
            </p>
          </div>
        ) : isAllEmpty ? (
          <EmptyState
            mode="all-empty"
            onCreateCampaign={() => void startCampaign()}
          />
        ) : isFilterEmpty ? (
          <EmptyState mode="filter-empty" onClearFilters={clearFilters} />
        ) : (
          <div className="space-y-4">
            {filteredItems.map((item) => (
              <CampaignCard
                key={item.address}
                address={item.address}
                backendData={item.backend}
                onConnect={() => void connectWallet()}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FilterSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className="flex h-10 w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function EmptyState({
  mode,
  onClearFilters,
  onCreateCampaign,
}: {
  mode: "all-empty" | "filter-empty";
  onClearFilters?: () => void;
  onCreateCampaign?: () => void;
}) {
  if (mode === "all-empty") {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
        <p className="font-mono text-sm font-semibold text-foreground">
          No campaigns yet
        </p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          Be the first to deploy a confidential allocation campaign.
        </p>
        {onCreateCampaign && (
          <Button className="mt-6" onClick={onCreateCampaign}>
            Create the first campaign
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
      <p className="font-mono text-sm font-semibold text-foreground">
        No matching campaigns
      </p>
      <p className="mt-2 font-mono text-xs text-muted-foreground">
        Adjust the search, status, or sort to widen the directory.
      </p>
      {onClearFilters && (
        <Button variant="outline" className="mt-6" onClick={onClearFilters}>
          Clear filters
        </Button>
      )}
    </div>
  );
}

function compareBigInt(left?: bigint, right?: bigint) {
  const a = left ?? -1n;
  const b = right ?? -1n;
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

function safeBigint(value: string): bigint | undefined {
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function nameMatches(
  name: string | null | undefined,
  normalizedQuery: string,
): boolean {
  if (!name) return false;
  return name.toLowerCase().includes(normalizedQuery);
}
