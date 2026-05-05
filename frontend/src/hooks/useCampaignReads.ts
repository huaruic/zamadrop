import { useReadContracts } from "wagmi";

import { CAMPAIGN_ABI } from "@/abis";

/** Multicall the public state of a campaign. All 4 role pages use this.
 * Returns typed scalars + an `isLoading` flag. Individual fields may be
 * `undefined` while loading or if a specific call failed. */
export function useCampaignReads(campaignAddress: `0x${string}`) {
  const query = useReadContracts({
    contracts: [
      { address: campaignAddress, abi: CAMPAIGN_ABI, functionName: "admin" },
      { address: campaignAddress, abi: CAMPAIGN_ABI, functionName: "auditor" },
      {
        address: campaignAddress,
        abi: CAMPAIGN_ABI,
        functionName: "declaredTotal",
      },
      {
        address: campaignAddress,
        abi: CAMPAIGN_ABI,
        functionName: "recipientCount",
      },
      {
        address: campaignAddress,
        abi: CAMPAIGN_ABI,
        functionName: "finalized",
      },
      { address: campaignAddress, abi: CAMPAIGN_ABI, functionName: "token" },
      {
        address: campaignAddress,
        abi: CAMPAIGN_ABI,
        functionName: "finalizeCheckHandle",
      },
    ],
  });

  const reads = query.data;
  return {
    admin: reads?.[0]?.result as `0x${string}` | undefined,
    auditor: reads?.[1]?.result as `0x${string}` | undefined,
    declaredTotal: reads?.[2]?.result as bigint | undefined,
    recipientCount: reads?.[3]?.result as bigint | undefined,
    finalized: reads?.[4]?.result as boolean | undefined,
    tokenAddress: reads?.[5]?.result as `0x${string}` | undefined,
    finalizeCheckHandle: reads?.[6]?.result as `0x${string}` | undefined,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
