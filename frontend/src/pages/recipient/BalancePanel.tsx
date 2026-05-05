import { useReadContract } from "wagmi";

import { ERC20_ABI } from "@/abis";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatTokenAmount } from "@/hooks/useTokenMeta";

interface BalancePanelProps {
  tokenAddress?: `0x${string}`;
  account: `0x${string}`;
  decimals: number;
  symbol?: string;
}

/** Live ERC-20 balance for the connected recipient. Polls every 8s so it
 * picks up the executor's `executeTransfer` settlement without a manual refresh. */
export function BalancePanel({
  tokenAddress,
  account,
  decimals,
  symbol,
}: BalancePanelProps) {
  const { data: balance } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
    query: {
      enabled: !!tokenAddress,
      refetchInterval: 8000,
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your token balance</CardTitle>
        <CardDescription>
          Refreshes every ~8 seconds. After settlement, expect the new balance
          to appear within one block.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="font-mono text-3xl font-semibold tracking-tight">
          {formatTokenAmount(balance as bigint | undefined, decimals, symbol)}
        </div>
      </CardContent>
    </Card>
  );
}
