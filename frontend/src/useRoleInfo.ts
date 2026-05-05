import { useReadContract } from "wagmi";
import { CAMPAIGN_ABI } from "./abis";
import { CONTRACTS } from "./config";

function sameAddress(a?: string, b?: string) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export function useRoleInfo(address?: `0x${string}`) {
  const { data: adminAddress } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "admin",
  });

  const { data: auditorAddress } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "auditor",
  });

  const { data: allocationSet } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "allocationSet",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const resolvedAdmin = adminAddress as `0x${string}` | undefined;
  const resolvedAuditor = auditorAddress as `0x${string}` | undefined;

  const isAdmin = sameAddress(address, resolvedAdmin);
  const isAuditor = sameAddress(address, resolvedAuditor);
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
