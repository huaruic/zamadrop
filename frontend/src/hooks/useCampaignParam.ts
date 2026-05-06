import { useOutletContext } from "react-router-dom";

import { useCampaignAddressFromContext } from "@/pages/campaign-context";

/** Read the campaign address either from the V6 OutletContext (legacy
 *  /campaign/:address/<tab> route) or the V7 CampaignAddressContext (new
 *  /c/:address route in CampaignDetail). The first one in scope wins.
 *
 *  Falling through both — i.e. mounting a role page directly without either
 *  provider — is a programming error and will throw via the existing
 *  Outlet typing on undefined access. */
export function useCampaignParam(): { campaignAddress: `0x${string}` } {
  const fromV7 = useCampaignAddressFromContext();
  // useOutletContext throws if no provider; we catch by reading defensively.
  // react-router 7 returns `undefined` (not throwing) when called outside an
  // Outlet's provider, so a soft optional cast is enough.
  const fromV6 = useOutletContext<
    { campaignAddress: `0x${string}` } | undefined
  >();
  if (fromV7) return { campaignAddress: fromV7 };
  if (fromV6) return fromV6;
  // Should never happen in practice — surface a clear error rather than
  // letting destructuring silently produce undefined.
  throw new Error(
    "useCampaignParam called outside CampaignDetail or CampaignLayout",
  );
}
