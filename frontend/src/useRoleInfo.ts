import { useReadContract } from "wagmi";
import { CAMPAIGN_ABI } from "./abis";
import { CONTRACTS } from "./config";

function sameAddress(a?: string, b?: string) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export function useRoleInfo(
  walletAddress?: `0x${string}`,
  campaignAddress: `0x${string}` = CONTRACTS.campaign,
) {
  const { data: adminAddress } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: campaignAddress,
    functionName: "admin",
  });

  const { data: auditorAddress } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: campaignAddress,
    functionName: "auditor",
  });

  const { data: allocationSet } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: campaignAddress,
    functionName: "allocationSet",
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress },
  });

  const resolvedAdmin = adminAddress as `0x${string}` | undefined;
  const resolvedAuditor = auditorAddress as `0x${string}` | undefined;

  const isAdmin = sameAddress(walletAddress, resolvedAdmin);
  const isAuditor = sameAddress(walletAddress, resolvedAuditor);
  const isRecipient = allocationSet === true;

  const roleLabels = [
    isAdmin ? "Admin" : null,
    isAuditor ? "Auditor" : null,
    isRecipient ? "Recipient" : null,
  ].filter(Boolean) as string[];

  return {
    adminAddress: resolvedAdmin,
    auditorAddress: resolvedAuditor,
    isAdmin,
    isAuditor,
    isRecipient,
    roleLabels,
  };
}
