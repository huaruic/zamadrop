import { useReadContract } from "wagmi";

import { ERC20_ABI } from "@/abis";

/** Read the ERC20 metadata (symbol + decimals) for a token address.
 * Reads are gated on a defined address. */
export function useTokenMeta(tokenAddress?: `0x${string}`) {
  const { data: symbol } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "symbol",
    query: { enabled: !!tokenAddress },
  });

  const { data: decimalsRaw } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "decimals",
    query: { enabled: !!tokenAddress },
  });

  return {
    symbol: symbol as string | undefined,
    decimals: (decimalsRaw as number | undefined) ?? 0,
  };
}

/** Format a uint64 token amount with decimals into a human string with thousands separators. */
export function formatTokenAmount(
  amount: bigint | undefined,
  decimals: number,
  symbol?: string,
): string {
  if (amount === undefined) return "—";
  const div = 10n ** BigInt(decimals);
  const whole = amount / div;
  const formatted = whole.toLocaleString("en-US");
  return symbol ? `${formatted} ${symbol}` : formatted;
}

/** Inverse: parse a user-typed amount string into uint64 base units. */
export function parseTokenAmount(input: string, decimals: number): bigint {
  if (!input) return 0n;
  const trimmed = input.trim();
  const [whole = "0", frac = ""] = trimmed.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}
