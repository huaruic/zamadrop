import { createContext, useContext } from "react";

/** Context that exposes the campaign address to nested role pages mounted
 *  under `/c/:address`. The legacy CampaignLayout passes the same value via
 *  `useOutletContext`; `useCampaignParam` falls through to whichever provider
 *  is in scope.
 *
 *  Kept in its own module so CampaignDetail.tsx remains a
 *  components-only file (react-refresh/only-export-components rule).
 */
export const CampaignAddressContext = createContext<`0x${string}` | null>(
  null,
);

export function useCampaignAddressFromContext(): `0x${string}` | null {
  return useContext(CampaignAddressContext);
}
