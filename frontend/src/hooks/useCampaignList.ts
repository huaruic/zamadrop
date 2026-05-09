import { useQuery } from "@tanstack/react-query";

import { FALLBACK_CAMPAIGNS } from "@/config";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

const KNOWN_CAMPAIGNS_KEY = "zd:knownCampaigns";

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export interface BackendCampaign {
  address: string;
  admin: string;
  auditor: string;
  token: string;
  declaredTotal: string;
  recipientCount: number;
  recipientListHash: string;
  state: string;
  name: string | null;
  description: string | null;
  deployedAtBlock: string | null;
  deployedTxHash: string | null;
  finalizedAtBlock: string | null;
  createdAt: string;
}

export interface CampaignListItem {
  address: `0x${string}`;
  backend: BackendCampaign | null;
}

export interface UseCampaignListResult {
  items: CampaignListItem[];
  source: "backend" | "fallback";
  isLoading: boolean;
  error?: Error;
  refetch: () => void;
}

interface QueryResult {
  items: CampaignListItem[];
  source: "backend" | "fallback";
}

function isValidAddress(value: string): value is `0x${string}` {
  return ADDRESS_REGEX.test(value);
}

function readKnownCampaigns(): `0x${string}`[] {
  try {
    const raw = localStorage.getItem(KNOWN_CAMPAIGNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: `0x${string}`[] = [];
    for (const entry of parsed) {
      if (typeof entry === "string" && isValidAddress(entry)) {
        out.push(entry);
      }
    }
    return out;
  } catch {
    return [];
  }
}

function buildFallback(): CampaignListItem[] {
  const seen = new Set<string>();
  const items: CampaignListItem[] = [];
  for (const addr of [...readKnownCampaigns(), ...FALLBACK_CAMPAIGNS]) {
    const lower = addr.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    items.push({ address: addr, backend: null });
  }
  return items;
}

async function fetchCampaigns(signal: AbortSignal): Promise<QueryResult> {
  const res = await fetch(`${BACKEND_URL}/api/campaigns`, {
    method: "GET",
    signal,
  });
  if (!res.ok) {
    throw new Error(`Backend /api/campaigns returned ${res.status}`);
  }
  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("Backend /api/campaigns returned non-array body");
  }
  const seen = new Set<string>();
  const items: CampaignListItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as BackendCampaign;
    const addr =
      typeof record.address === "string" ? record.address.toLowerCase() : "";
    if (!isValidAddress(addr)) continue;
    if (seen.has(addr)) continue;
    seen.add(addr);
    items.push({
      address: addr,
      backend: { ...record, address: addr },
    });
  }
  return { items, source: "backend" };
}

export function useCampaignList(): UseCampaignListResult {
  const query = useQuery<QueryResult, Error>({
    queryKey: ["campaign-list"],
    queryFn: ({ signal }) => fetchCampaigns(signal),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  if (query.data) {
    return {
      items: query.data.items,
      source: query.data.source,
      isLoading: query.isLoading,
      refetch: () => {
        void query.refetch();
      },
    };
  }

  if (query.isError) {
    return {
      items: buildFallback(),
      source: "fallback",
      isLoading: false,
      error: query.error,
      refetch: () => {
        void query.refetch();
      },
    };
  }

  return {
    items: [],
    source: "backend",
    isLoading: query.isLoading,
    refetch: () => {
      void query.refetch();
    },
  };
}
