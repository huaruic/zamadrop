/** Shorten a 0x-prefixed hex blob to `0xab12…34cd` for display. */
export function shortHandle(handle: `0x${string}`): string {
  if (handle.length <= 12) return handle;
  return `${handle.slice(0, 6)}…${handle.slice(-4)}`;
}
