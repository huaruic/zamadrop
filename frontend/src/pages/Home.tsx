import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAccount, useConnect, useReadContracts } from "wagmi";

import { CAMPAIGN_ABI } from "@/abis";
import { CampaignCard } from "@/components/CampaignCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CAMPAIGNS } from "@/config";
import { hasWalletProvider, openMetaMaskInstall } from "@/lib/wallet-connect";

const DIRECTORY_ID = "campaign-directory";
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

type PendingAction = "deploy" | null;
type DirectoryPhase = "Setup" | "Finalize-pending" | "Claiming" | "Loading";
type StatusFilter = "all" | DirectoryPhase;
type SortOption = "recent" | "largest" | "recipients" | "address";

interface DirectoryItem {
  address: `0x${string}`;
  phase: DirectoryPhase;
  declaredTotal?: bigint;
  recipientCount?: bigint;
}

export default function Home() {
  const navigate = useNavigate();
  const { isConnected } = useAccount();
  const { connect, connectors, error } = useConnect();
  const connector = connectors[0];
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("recent");

  useEffect(() => {
    if (!pendingAction || !isConnected) return;
    navigate("/wizard");
    const clear = setTimeout(() => setPendingAction(null), 0);
    return () => clearTimeout(clear);
  }, [isConnected, navigate, pendingAction]);

  useEffect(() => {
    if (!pendingAction || !error) return;
    const clear = setTimeout(() => setPendingAction(null), 0);
    return () => clearTimeout(clear);
  }, [error, pendingAction]);

  const { data: directoryReads } = useReadContracts({
    contracts: CAMPAIGNS.flatMap((address) => [
      { address, abi: CAMPAIGN_ABI, functionName: "declaredTotal" as const },
      { address, abi: CAMPAIGN_ABI, functionName: "recipientCount" as const },
      { address, abi: CAMPAIGN_ABI, functionName: "finalized" as const },
      {
        address,
        abi: CAMPAIGN_ABI,
        functionName: "finalizeCheckHandle" as const,
      },
    ]),
  });

  const directoryItems: DirectoryItem[] = CAMPAIGNS.map((address, index) => {
    const offset = index * 4;
    const declaredTotal = directoryReads?.[offset]?.result as bigint | undefined;
    const recipientCount = directoryReads?.[offset + 1]?.result as
      | bigint
      | undefined;
    const finalized = directoryReads?.[offset + 2]?.result as
      | boolean
      | undefined;
    const finalizeCheckHandle = directoryReads?.[offset + 3]?.result as
      | `0x${string}`
      | undefined;

    return {
      address,
      phase: derivePhase(finalized, finalizeCheckHandle),
      declaredTotal,
      recipientCount,
    };
  });

  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = directoryItems
    .filter((item) => {
      if (
        normalizedQuery &&
        !item.address.toLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }
      if (statusFilter !== "all" && item.phase !== statusFilter) {
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
      return directoryItems.findIndex((item) => item.address === left.address) -
        directoryItems.findIndex((item) => item.address === right.address);
    });

  const campaignCount = directoryItems.length;
  const claimingCount = directoryItems.filter(
    (item) => item.phase === "Claiming",
  ).length;
  const setupCount = directoryItems.filter(
    (item) => item.phase === "Setup",
  ).length;
  const finalizePendingCount = directoryItems.filter(
    (item) => item.phase === "Finalize-pending",
  ).length;
  const totalRecipients = directoryItems.reduce(
    (sum, item) => sum + (item.recipientCount ?? 0n),
    0n,
  );

  const startCampaign = async () => {
    if (isConnected) {
      navigate("/wizard");
      return;
    }

    if (!connector) {
      openMetaMaskInstall();
      return;
    }

    if (!(await hasWalletProvider(connector))) {
      openMetaMaskInstall();
      return;
    }

    setPendingAction("deploy");
    connect({ connector });
  };

  return (
    <div className="space-y-8">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(320px,0.95fr)]">
        <Card className="gradient-card border-primary/20 shadow-card">
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Public directory</Badge>
              <Badge variant="outline">Overview first</Badge>
              <Badge variant="outline">Sepolia</Badge>
            </div>
            <div className="space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                ZamaDrop
              </p>
              <CardTitle className="text-3xl md:text-4xl">
                Campaign Directory
              </CardTitle>
              <CardDescription className="max-w-3xl font-mono text-sm leading-relaxed text-muted-foreground">
                Browse every public campaign first. Wallet connection only
                unlocks actions: starting a campaign and revealing any Admin,
                Recipient, or Auditor access tied to that wallet.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void startCampaign()}>
              Start a campaign
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                document.getElementById(DIRECTORY_ID)?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
            >
              Browse campaigns
            </Button>
            <p className="font-mono text-[11px] text-muted-foreground">
              No wallet is required to inspect the public overview of any
              campaign.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80 bg-card/90">
          <CardHeader>
            <CardTitle>Entry points</CardTitle>
            <CardDescription>
              The homepage is a directory, not a role switcher.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <EntryRow
              kicker="1"
              title="Browse publicly"
              body="Anyone can open campaign overviews without connecting a wallet."
            />
            <EntryRow
              kicker="2"
              title="Connect for actions"
              body="Connecting a wallet is only needed to start a campaign or reveal role tabs on a campaign."
            />
            <EntryRow
              kicker="3"
              title="Go deeper inside a campaign"
              body="Admin, Recipient, and Auditor views stay inside each campaign instead of living as homepage entry cards."
            />
            {error && (
              <Alert variant="muted">
                <AlertTitle>Wallet connection note</AlertTitle>
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Campaigns tracked"
          value={String(campaignCount)}
          note="Public overviews available now"
        />
        <MetricCard
          label="Claiming live"
          value={String(claimingCount)}
          note="Finalized campaigns accepting claims"
        />
        <MetricCard
          label="Setup in progress"
          value={String(setupCount)}
          note="Campaigns still preparing allocations"
        />
        <MetricCard
          label="Recipients tracked"
          value={formatBigInt(totalRecipients)}
          note={`${finalizePendingCount} finalize-pending`}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_320px]">
        <div id={DIRECTORY_ID} className="space-y-4">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h2 className="font-mono text-lg font-semibold tracking-tight">
                Campaigns
              </h2>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {filteredItems.length} shown · {campaignCount} total
              </p>
            </div>
            <Badge variant="outline">Vertical directory</Badge>
          </header>

          <Card className="border-border/80 bg-card/80">
            <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1.2fr)_180px_180px]">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by campaign address"
              />
              <FilterSelect
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
              >
                <option value="all">All statuses</option>
                <option value="Setup">Setup</option>
                <option value="Finalize-pending">Finalize pending</option>
                <option value="Claiming">Claiming</option>
                <option value="Loading">Loading</option>
              </FilterSelect>
              <FilterSelect
                value={sortBy}
                onChange={(event) =>
                  setSortBy(event.target.value as SortOption)
                }
              >
                <option value="recent">Directory order</option>
                <option value="largest">Largest declared total</option>
                <option value="recipients">Most recipients</option>
                <option value="address">Address</option>
              </FilterSelect>
            </CardContent>
          </Card>

          {filteredItems.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-4">
              {filteredItems.map((item, index) => (
                <DirectoryEntry
                  key={item.address}
                  index={index}
                  item={item}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <InfoCard
            title="Wallet actions"
            description="What changes after connection."
            body="Creating a campaign and opening role-specific tools still require a wallet. Public browsing does not."
          />
          <InfoCard
            title="Privacy boundary"
            description="Short and explicit."
            body="Amounts are encrypted before claim. The recipient list is still public on-chain, so this app avoids implying membership privacy."
            href="https://github.com/huaruic/zamadrop/blob/main/docs/SECURITY.md"
            linkLabel="Read the full boundary →"
          />
          <Card className="border-border/80 bg-card/90">
            <CardHeader>
              <CardTitle>Directory cues</CardTitle>
              <CardDescription>
                The home page should feel operational, not empty.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 font-mono text-xs text-muted-foreground">
              <DirectoryCue
                status="Setup"
                body="Allocations are still being prepared or finalized."
              />
              <DirectoryCue
                status="Finalize-pending"
                body="The campaign is waiting for the KMS-backed finalize callback."
              />
              <DirectoryCue
                status="Claiming"
                body="Recipients can decrypt and claim inside their campaign view."
              />
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}

function EntryRow({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body: string;
}) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
      <div className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-mono text-[10px] text-primary">
        {kicker}
      </div>
      <div className="space-y-1">
        <div className="font-mono text-xs uppercase tracking-[0.18em] text-foreground">
          {title}
        </div>
        <p className="font-mono text-xs leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Card className="border-border/80 bg-card/90">
      <CardContent className="space-y-2 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <div className="font-mono text-3xl font-semibold tracking-tight">
          {value}
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function DirectoryEntry({
  index,
  item,
}: {
  index: number;
  item: DirectoryItem;
}) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card/60 p-4 shadow-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Campaign {String(index + 1).padStart(2, "0")}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={phaseBadgeVariant(item.phase)}>{item.phase}</Badge>
            <Badge variant="outline">
              {item.recipientCount === undefined
                ? "Recipients —"
                : `Recipients ${formatBigInt(item.recipientCount)}`}
            </Badge>
            <Badge variant="outline">
              {item.declaredTotal === undefined
                ? "Declared total —"
                : `Declared total ${formatBigInt(item.declaredTotal)}`}
            </Badge>
          </div>
        </div>
        <Link
          to={`/campaign/${item.address}`}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-primary hover:underline"
        >
          Open overview →
        </Link>
      </div>
      <Link
        to={`/campaign/${item.address}`}
        className="group block transition hover:-translate-y-0.5"
      >
        <CampaignCard address={item.address} />
      </Link>
    </div>
  );
}

function FilterSelect(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  return (
    <select
      {...props}
      className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    />
  );
}

function InfoCard({
  title,
  description,
  body,
  href,
  linkLabel,
}: {
  title: string;
  description: string;
  body: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <Card className="border-border/80 bg-card/90">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="font-mono text-xs leading-relaxed text-muted-foreground">
          {body}
        </p>
        {href && linkLabel && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-block font-mono text-xs text-primary hover:underline"
          >
            {linkLabel}
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function DirectoryCue({
  status,
  body,
}: {
  status: Exclude<DirectoryPhase, "Loading">;
  body: string;
}) {
  return (
    <div className="space-y-1 rounded-xl border border-border/70 bg-surface/80 p-3">
      <Badge variant={phaseBadgeVariant(status)}>{status}</Badge>
      <p>{body}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center">
      <p className="font-mono text-sm text-muted-foreground">
        No campaigns match the current directory filters.
      </p>
    </div>
  );
}

function compareBigInt(left?: bigint, right?: bigint) {
  const a = left ?? -1n;
  const b = right ?? -1n;
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

function derivePhase(
  finalized: boolean | undefined,
  finalizeCheckHandle: `0x${string}` | undefined,
): DirectoryPhase {
  if (finalized === undefined) return "Loading";
  if (finalized) return "Claiming";
  return !finalizeCheckHandle || finalizeCheckHandle === ZERO_HASH
    ? "Setup"
    : "Finalize-pending";
}

function formatBigInt(value: bigint) {
  return value.toLocaleString("en-US");
}

function phaseBadgeVariant(
  phase: DirectoryPhase,
): "default" | "cipher" | "success" | "muted" {
  switch (phase) {
    case "Setup":
      return "default";
    case "Finalize-pending":
      return "cipher";
    case "Claiming":
      return "success";
    case "Loading":
      return "muted";
  }
}
