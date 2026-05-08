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

// Strict decimal parts: whole part = digits-only (no leading zeros except "0"),
// fractional = digits-only. Bare BigInt() would silently accept "0x10" as hex,
// turn "" into 0n, and parse "  5  " — none of which is acceptable for token
// amount input.
const STRICT_DIGITS = /^(?:0|[1-9][0-9]*)$/;
const FRAC_DIGITS = /^[0-9]+$/;

/** Inverse: parse a user-typed amount string into uint64 base units.
 *
 * Strict: rejects whitespace, exponents, hex, signs, and empty fractional
 * parts. Throws on malformed input rather than silently returning 0n. */
export function parseTokenAmount(input: string, decimals: number): bigint {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("empty token amount");
  }
  if (input !== input.trim()) {
    throw new Error(`invalid token amount: "${input}"`);
  }
  const dotIndex = input.indexOf(".");
  const whole = dotIndex === -1 ? input : input.slice(0, dotIndex);
  const frac = dotIndex === -1 ? "" : input.slice(dotIndex + 1);

  if (!STRICT_DIGITS.test(whole)) {
    throw new Error(`invalid token amount: "${input}"`);
  }
  if (frac.length > 0 && !FRAC_DIGITS.test(frac)) {
    throw new Error(`invalid token amount: "${input}"`);
  }
  if (frac.length > decimals) {
    throw new Error(
      `too many fractional digits (max ${decimals}): "${input}"`,
    );
  }
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}
