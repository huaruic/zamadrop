import { useQuery } from "@tanstack/react-query";
import { parseAbiItem } from "viem";
import { usePublicClient } from "wagmi";

const ALLOCATION_SET_EVENT = parseAbiItem(
  "event AllocationSet(address indexed recipient)",
);

const CLAIMED_EVENT = parseAbiItem(
  "event Claimed(address indexed recipient)",
);

const TOKEN_TRANSFERRED_EVENT = parseAbiItem(
  "event TokenTransferred(address indexed user, uint64 amount)",
);

/** Sepolia public RPC caps eth_getLogs at 50k block range. We default to a
 * 49k window from `latest` to stay under the limit and complete in one call.
 * Callers needing a larger window can pass an explicit `fromBlock`. */
const DEFAULT_LOOKBACK = 49_000n;

export interface AllocationEvent {
  recipient: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: bigint;
}

export interface ClaimedEvent {
  recipient: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: bigint;
}

export interface TransferredEvent {
  recipient: `0x${string}`;
  amount: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
}

/** Pull historical AllocationSet events. Used by Admin to enumerate
 * recipients (the contract has no on-chain array, only a mapping). */
export function useAllocationEvents(
  campaignAddress: `0x${string}`,
  options?: { fromBlock?: bigint },
) {
  const publicClient = usePublicClient();
  const explicitFromBlock = options?.fromBlock;

  return useQuery<AllocationEvent[]>({
    queryKey: [
      "allocation-events",
      campaignAddress,
      explicitFromBlock?.toString() ?? "auto",
    ],
    enabled: !!publicClient,
    queryFn: async () => {
      if (!publicClient) return [];
      const fromBlock =
        explicitFromBlock ?? (await computeRecentFromBlock(publicClient));
      const logs = await publicClient.getLogs({
        address: campaignAddress,
        event: ALLOCATION_SET_EVENT,
        fromBlock,
        toBlock: "latest",
      });
      return logs.map((log) => ({
        recipient: log.args.recipient as `0x${string}`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      }));
    },
  });
}

/** Pull historical Claimed events. Used by Auditor activity feed. */
export function useClaimedEvents(
  campaignAddress: `0x${string}`,
  options?: { fromBlock?: bigint },
) {
  const publicClient = usePublicClient();
  const explicitFromBlock = options?.fromBlock;

  return useQuery<ClaimedEvent[]>({
    queryKey: [
      "claimed-events",
      campaignAddress,
      explicitFromBlock?.toString() ?? "auto",
    ],
    enabled: !!publicClient,
    queryFn: async () => {
      if (!publicClient) return [];
      const fromBlock =
        explicitFromBlock ?? (await computeRecentFromBlock(publicClient));
      const logs = await publicClient.getLogs({
        address: campaignAddress,
        event: CLAIMED_EVENT,
        fromBlock,
        toBlock: "latest",
      });
      return logs.map((log) => ({
        recipient: log.args.recipient as `0x${string}`,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      }));
    },
  });
}

/** Pull historical TokenTransferred events. */
export function useTransferredEvents(
  campaignAddress: `0x${string}`,
  options?: { fromBlock?: bigint },
) {
  const publicClient = usePublicClient();
  const explicitFromBlock = options?.fromBlock;

  return useQuery<TransferredEvent[]>({
    queryKey: [
      "transferred-events",
      campaignAddress,
      explicitFromBlock?.toString() ?? "auto",
    ],
    enabled: !!publicClient,
    queryFn: async () => {
      if (!publicClient) return [];
      const fromBlock =
        explicitFromBlock ?? (await computeRecentFromBlock(publicClient));
      const logs = await publicClient.getLogs({
        address: campaignAddress,
        event: TOKEN_TRANSFERRED_EVENT,
        fromBlock,
        toBlock: "latest",
      });
      return logs.map((log) => ({
        recipient: log.args.user as `0x${string}`,
        amount: log.args.amount as bigint,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      }));
    },
  });
}

async function computeRecentFromBlock(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
): Promise<bigint> {
  const latest = await publicClient.getBlockNumber();
  return latest > DEFAULT_LOOKBACK ? latest - DEFAULT_LOOKBACK : 0n;
}
