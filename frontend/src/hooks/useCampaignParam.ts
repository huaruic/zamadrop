import { useOutletContext } from "react-router-dom";

/** Read campaign address provided by `<CampaignLayout />` via Outlet context.
 * Sub-pages (Admin / Recipient / Auditor) call this to get a typed handle
 * without re-parsing `useParams()`. */
export function useCampaignParam(): { campaignAddress: `0x${string}` } {
  return useOutletContext<{ campaignAddress: `0x${string}` }>();
}
