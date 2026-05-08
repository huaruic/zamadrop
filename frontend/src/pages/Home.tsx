import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";

import { SiweButton } from "@/auth/SiweButton";
import { authHeader, getSessionToken } from "@/auth/siwe-client";
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
import { CAMPAIGNS } from "@/config";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

interface CampaignSummary {
  address: `0x${string}`;
  name?: string | null;
  declaredTotal?: string | number | null;
  recipientCount?: number | null;
  status?: string | null;
}

/** V7 Home page · spec: recipient-discovery + admin-deployment-flow.
 *
 * Three role-segmented sections, each conditional on data presence:
 *   1. As Admin       — public /api/admin/:address/campaigns (no SIWE)
 *   2. As Recipient   — SIWE-gated /api/me/campaigns (only when session)
 *   3. As Auditor     — public /api/auditor/:address/campaigns (no SIWE)
 *
 * The auditor list is intentionally public: per the auditor-verification
 * spec, gating it would falsely imply auditor relationships are private.
 * They are not — they live in the campaign's immutable `auditor()` slot. */
export default function Home() {
  const { address, isConnected } = useAccount();
  // Bumped on SIWE state change so the recipient section refetches.
  const [sessionTick, setSessionTick] = useState(0);
  const hasSession = !!getSessionToken();

  const [adminCampaigns, setAdminCampaigns] = useState<
    CampaignSummary[] | null
  >(null);
  const [recipientCampaigns, setRecipientCampaigns] = useState<
    CampaignSummary[] | null
  >(null);
  const [auditorCampaigns, setAuditorCampaigns] = useState<
    CampaignSummary[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  // Admin + Auditor sections fetch by connected wallet (no SIWE needed).
  // We side-effect setState only inside async callbacks (not in the effect
  // body sync path) to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void (async () => {
      try {
        const [adminRes, auditorRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/admin/${address}/campaigns`).catch(
            () => null,
          ),
          fetch(`${BACKEND_URL}/api/auditor/${address}/campaigns`).catch(
            () => null,
          ),
        ]);
        if (cancelled) return;
        setAdminCampaigns(
          adminRes && adminRes.ok ? await adminRes.json() : [],
        );
        setAuditorCampaigns(
          auditorRes && auditorRes.ok ? await auditorRes.json() : [],
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Recipient section requires a SIWE session.
  useEffect(() => {
    if (!hasSession) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/me/campaigns`, {
          method: "POST",
          headers: { ...authHeader(), "Content-Type": "application/json" },
        });
        if (cancelled) return;
        if (res.ok) {
          setRecipientCampaigns(await res.json());
        } else {
          setRecipientCampaigns([]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasSession, sessionTick]);

  // When wallet/session is dropped, drop the cached lists so the
  // re-mounted-section path doesn't briefly render stale data. We compute
  // these as derived render-time values rather than separate effects to
  // avoid setState-in-effect cascades.
  const adminToShow = address ? adminCampaigns : null;
  const auditorToShow = address ? auditorCampaigns : null;
  const recipientToShow = hasSession ? recipientCampaigns : null;

  return (
    <>
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="font-mono text-2xl font-semibold tracking-tight md:text-3xl">
            ZamaDrop
          </h1>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Confidential allocations · public accountability
          </p>
        </div>
        <SiweButton onSessionChange={() => setSessionTick((n) => n + 1)} />
      </header>

      {/* Primary CTA: deploy a campaign. Always visible for discoverability;
          disabled state until wallet connects so first-time visitors still
          see the action exists. */}
      <Card className="mb-6 border-primary/40 bg-primary/5">
        <CardHeader>
          <CardTitle>Deploy a confidential drop</CardTitle>
          <CardDescription>
            Distribute encrypted token allocations with on-chain sum
            verification. Recipients claim privately; the public ledger only
            shows that a claim happened.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isConnected ? (
            <Button asChild size="sm">
              <Link to="/wizard">Start the 5-step wizard →</Link>
            </Button>
          ) : (
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Connect a wallet (top right) to deploy a campaign.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Honest privacy claim. Spec: recipient-discovery → "SIWE 范围的诚实表述". */}
      <Card className="mb-8 border-cipher/40 bg-cipher/5">
        <CardHeader>
          <CardTitle>Privacy boundary</CardTitle>
          <CardDescription>
            What this app actually protects, in plain terms.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 font-mono text-xs leading-relaxed">
          <p>
            在 claim 之前对每个分配金额加密；接收者的资格信息（在 AllocationSet
            事件里）是链上公开的。
          </p>
          <p className="text-muted-foreground">
            Amounts are private before claim. Eligibility (the recipient
            list) is public on-chain.
          </p>
          <p>
            {/* GitHub blob URL — docs/ isn't shipped to the Vite public dir,
                so a relative `/docs/SECURITY.md` would 404. Linking to the
                source-of-truth file in the repo keeps the claim verifiable. */}
            <a
              href="https://github.com/huaruic/zamadrop/blob/main/docs/SECURITY.md"
              target="_blank"
              rel="noreferrer"
              className="text-cipher hover:underline"
            >
              Read the full privacy boundary →
            </a>
          </p>
        </CardContent>
      </Card>

      <RoleExplainer />

      <div className="mb-10">
        <SectionHeading
          title="Explore Campaigns"
          subtitle="Public overview for every campaign"
        />
        {CAMPAIGNS.length === 0 ? (
          <p className="font-mono text-xs text-muted-foreground">
            No campaigns found.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {CAMPAIGNS.map((address) => (
              <Link
                key={address}
                to={`/campaign/${address}`}
                className="group block transition hover:-translate-y-0.5"
              >
                <CampaignCard address={address} />
                <div className="mt-3 text-right font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground transition group-hover:text-primary">
                  Open overview →
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Backend unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!isConnected && (
        <Alert variant="muted" className="mb-6">
          <AlertTitle>Connect a wallet</AlertTitle>
          <AlertDescription>
            You can inspect every campaign publicly without connecting. After
            you connect a wallet, ZamaDrop will reveal any Admin, Recipient,
            or Auditor access tied to that wallet. Recipient discovery across
            campaigns still uses a SIWE sign-in (no gas).
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-8">
        <Section
          title="As Admin"
          subtitle="Campaigns deployed by you"
          campaigns={adminToShow}
          show={isConnected}
        />

        <Section
          title="As Recipient"
          subtitle="Campaigns where you can claim"
          campaigns={recipientToShow}
          show={isConnected && hasSession}
          gateMessage={
            isConnected && !hasSession
              ? "Sign in (no gas) above to discover campaigns where you're a recipient."
              : undefined
          }
        />

        <Section
          title="As Auditor"
          subtitle="Campaigns you can verify"
          campaigns={auditorToShow}
          show={isConnected}
        />
      </div>
    </>
  );
}

interface SectionProps {
  title: string;
  subtitle: string;
  campaigns: CampaignSummary[] | null;
  show: boolean;
  gateMessage?: string;
}

function Section({
  title,
  subtitle,
  campaigns,
  show,
  gateMessage,
}: SectionProps) {
  if (gateMessage) {
    return (
      <div>
        <SectionHeading title={title} subtitle={subtitle} />
        <Alert variant="muted">
          <AlertDescription>{gateMessage}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!show) return null;

  return (
    <div>
      <SectionHeading title={title} subtitle={subtitle} />
      {campaigns === null ? (
        <p className="font-mono text-xs text-muted-foreground">Loading…</p>
      ) : campaigns.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          No campaigns found.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {campaigns.map((c) => (
            <CampaignSummaryCard key={c.address} campaign={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <header className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-mono text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {subtitle}
      </p>
    </header>
  );
}

function RoleExplainer() {
  return (
    <div className="mb-10">
      <SectionHeading
        title="Roles"
        subtitle="What each role can see and do"
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <RoleCard
          title="Public"
          body="Browse campaign overviews, track public status, and inspect progress without connecting a wallet."
        />
        <RoleCard
          title="Admin"
          body="Create campaigns, monitor live status, finalize setup, and recover from failed deployment or settlement paths."
        />
        <RoleCard
          title="Recipient"
          body="Decrypt your own allocation privately and claim tokens when the campaign is live."
        />
        <RoleCard
          title="Auditor"
          body="Verify recipient list integrity, check solvency, and inspect aggregate or per-claim audit evidence."
        />
      </div>
    </div>
  );
}

function RoleCard({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-xs leading-relaxed text-muted-foreground">
          {body}
        </p>
      </CardContent>
    </Card>
  );
}

function CampaignSummaryCard({
  campaign,
}: {
  campaign: CampaignSummary;
}) {
  return (
    <Link
      to={`/campaign/${campaign.address}`}
      className="group block transition hover:-translate-y-0.5"
    >
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>
                {campaign.name || shortAddr(campaign.address)}
              </CardTitle>
              <CardDescription>{shortAddr(campaign.address)}</CardDescription>
            </div>
            {campaign.status && (
              <Badge variant="outline">{campaign.status}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <Stat
              label="Declared total"
              value={
                campaign.declaredTotal !== undefined &&
                campaign.declaredTotal !== null
                  ? String(campaign.declaredTotal)
                  : "—"
              }
            />
            <Stat
              label="Recipients"
              value={
                campaign.recipientCount !== undefined &&
                campaign.recipientCount !== null
                  ? String(campaign.recipientCount)
                  : "—"
              }
            />
          </div>
          <div className="mt-4 text-right font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground transition group-hover:text-primary">
            Open overview →
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold tracking-tight">
        {value}
      </div>
    </div>
  );
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
