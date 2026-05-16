import { useQuery } from "@tanstack/react-query";

interface BackendCampaignRow {
  address: `0x${string}`;
  state: string;
  name: string | null;
}

/** Fetch the registered campaign list from the backend `/api/campaigns`
 * endpoint. Returns addresses newest-first (the backend already orders by
 * `created_at DESC`). On error or unreachable backend, react-query surfaces
 * `data === undefined` and the caller should fall back to the hardcoded
 * `CAMPAIGNS` from `@/config`. */
export function useBackendCampaigns() {
  return useQuery({
    queryKey: ["backend-campaigns"],
    queryFn: async (): Promise<`0x${string}`[]> => {
      const backendUrl =
        import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
      const res = await fetch(`${backendUrl}/api/campaigns`);
      if (!res.ok) {
        throw new Error(`Backend returned ${res.status}`);
      }
      const rows: BackendCampaignRow[] = await res.json();
      return rows.map((row) => row.address);
    },
    staleTime: 30_000,
    retry: 1,
  });
}
