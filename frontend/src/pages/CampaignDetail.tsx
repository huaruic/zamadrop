import { useEffect, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAccount, useReadContract } from "wagmi";

import { CAMPAIGN_ABI } from "@/abis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

import AdminPage from "./admin/AdminPage";
import AuditorPage from "./auditor/AuditorPage";
import { CampaignAddressContext } from "./campaign-context";
import PublicView from "./PublicView";
import RecipientPage from "./recipient/RecipientPage";

const KNOWN_CAMPAIGNS_KEY = "zd:knownCampaigns";

type EffectiveRole = "admin" | "auditor" | "recipient" | "public";
type RoleHint = "admin" | "auditor" | "recipient" | null;

/** V7 role-aware route dispatcher · spec: admin-deployment-flow §URL 接管.
 *
 * URL: /c/<address>?role=<admin|recipient|auditor>
 *
 * The `?role=` query is a UI HINT only. Actual permissions are derived from
 * on-chain reads of `admin()` / `auditor()` against the connected wallet.
 * If the URL claims admin but the connected wallet isn't the admin, we
 * render PublicView, never AdminPage. */
export default function CampaignDetail() {
  const { address: campaignAddressParam } = useParams();
  const [searchParams] = useSearchParams();
  const { address: walletAddress } = useAccount();

  const campaignAddress = campaignAddressParam as `0x${string}` | undefined;
  const roleHint = parseRoleHint(searchParams.get("role"));

  // Persist any visited campaign address into known-campaigns localStorage,
  // deduplicating case-insensitively.
  useEffect(() => {
    if (!campaignAddress) return;
    try {
      const raw = localStorage.getItem(KNOWN_CAMPAIGNS_KEY);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const lower = campaignAddress.toLowerCase();
      if (!list.map((s) => s.toLowerCase()).includes(lower)) {
        list.push(campaignAddress);
        localStorage.setItem(KNOWN_CAMPAIGNS_KEY, JSON.stringify(list));
      }
    } catch {
      /* localStorage unavailable — ignore */
    }
  }, [campaignAddress]);

  const { data: adminAddress } = useReadContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "admin",
    query: { enabled: !!campaignAddress },
  });
  const { data: auditorAddress } = useReadContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "auditor",
    query: { enabled: !!campaignAddress },
  });

  const effectiveRole: EffectiveRole = useMemo(() => {
    if (!walletAddress) {
      // Disconnected: respect the URL hint only for `recipient`, since admin
      // and auditor pages render preview state for non-role wallets anyway.
      // Falling through to public view is safer.
      return "public";
    }
    const lc = walletAddress.toLowerCase();
    if (
      typeof adminAddress === "string" &&
      adminAddress.toLowerCase() === lc
    ) {
      return "admin";
    }
    if (
      typeof auditorAddress === "string" &&
      auditorAddress.toLowerCase() === lc
    ) {
      return "auditor";
    }
    if (roleHint === "recipient") {
      // The recipient page itself reads `allocationSet[wallet]` and shows a
      // graceful "not on this list" alert when false — so it's safe to
      // dispatch here purely on the URL hint.
      return "recipient";
    }
    return "public";
  }, [walletAddress, adminAddress, auditorAddress, roleHint]);

  if (!campaignAddress || !/^0x[a-fA-F0-9]{40}$/.test(campaignAddress)) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Invalid campaign address</AlertTitle>
        <AlertDescription>
          The URL must be of the form <code>/c/0x…</code>.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <CampaignAddressContext.Provider value={campaignAddress}>
      <div className="space-y-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          ← Home
        </Link>

        <RoleHintMismatchAlert
          roleHint={roleHint}
          effectiveRole={effectiveRole}
        />

        {effectiveRole === "admin" ? (
          <AdminPage />
        ) : effectiveRole === "auditor" ? (
          <AuditorPage />
        ) : effectiveRole === "recipient" ? (
          <RecipientPage />
        ) : (
          <PublicView campaignAddress={campaignAddress} />
        )}
      </div>
    </CampaignAddressContext.Provider>
  );
}

function parseRoleHint(raw: string | null): RoleHint {
  if (raw === "admin" || raw === "auditor" || raw === "recipient") return raw;
  return null;
}

function RoleHintMismatchAlert({
  roleHint,
  effectiveRole,
}: {
  roleHint: RoleHint;
  effectiveRole: EffectiveRole;
}) {
  if (!roleHint) return null;
  if (roleHint === effectiveRole) {
    return (
      <div>
        <Badge variant="cipher">URL hint · {roleHint}</Badge>
      </div>
    );
  }
  return (
    <Alert variant="muted">
      <AlertTitle>URL hint · {roleHint} (preview)</AlertTitle>
      <AlertDescription>
        The URL suggests opening as <strong>{roleHint}</strong>, but the
        connected wallet does not hold that role on this campaign. Showing
        the public view instead — connect the right wallet to switch.
      </AlertDescription>
    </Alert>
  );
}
