/** Display address as `0xAdF4…12C7` (first 6 + last 4). */
export function shortAddr(addr?: `0x${string}`): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Same shape as shortAddr but for tx hashes (just a different semantic name). */
export function shortHash(hash?: `0x${string}`): string {
  if (!hash) return "—";
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export function isZeroHash(hash?: `0x${string}`): boolean {
  return !hash || hash.toLowerCase() === ZERO_HASH;
}
