// Strict uint64 parsing helpers.
//
// User-supplied numeric strings (allocation amounts, decimals, etc.) MUST flow
// through this module instead of `Number(...)` or bare `BigInt(...)`. JS Number
// loses precision above 2^53 and bare `BigInt("5e3")` throws — but `BigInt("5")`
// silently accepts whitespace-padded input via the regex JS uses internally.
// We explicitly reject anything that isn't a canonical decimal uint string and
// guard against overflow past 2^64 - 1.

const UINT64_MAX = (1n << 64n) - 1n;
const STRICT_UINT_REGEX = /^[1-9][0-9]*$|^0$/;

export function parseStrictUint64(input: string): bigint {
  if (typeof input !== "string") throw new Error("not a string");
  if (input === "") throw new Error("empty");
  if (!STRICT_UINT_REGEX.test(input)) {
    throw new Error(`invalid uint format: "${input}"`);
  }
  const value = BigInt(input);
  if (value > UINT64_MAX) throw new Error("uint64 overflow");
  return value;
}

export function formatUint64(value: bigint): string {
  return value.toString();
}
