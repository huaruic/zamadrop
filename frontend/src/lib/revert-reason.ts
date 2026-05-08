// Human-readable contract revert messages.
//
// viem / wagmi surface contract reverts as raw strings that often leak RPC
// quirks — Sepolia, for example, replaces a decoded custom error with the
// fallback话术 "gas limit too high" when simulation reverts without a decoded
// reason. This module greps the raw error message for known substrings and
// maps them to user-facing copy. Callers can pass `customMap` to override the
// defaults — useful when the same RPC fallback话术 means different things in
// different functions.
//
// We intentionally do NOT `instanceof`-check viem's ContractFunctionRevertedError:
// the class identity has shifted between viem versions and string grep is
// stable across them.

const KNOWN_PATTERNS: Record<string, string> = {
  NotFailed:
    "Campaign is not in Failed state. cancelCampaign only works after KMS reports a sum mismatch.",
  NotAdmin: "Only the campaign admin wallet can perform this action.",
  NotClaiming: "Campaign is not in Claiming state.",
  NotSetup:
    "Campaign is no longer in Setup — allocations are locked.",
  NotFinalizing: "Campaign is not awaiting KMS verification.",
  "User rejected": "Wallet signature was rejected.",
  "user rejected": "Wallet signature was rejected.",
};

function extractMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  if (err === undefined || err === null) return "";
  try {
    return String(err);
  } catch {
    return "";
  }
}

/**
 * Parse a viem write/simulation error into a human-readable message.
 * Falls back to the original message string when no known pattern matches.
 *
 * Recognized patterns (extend as needed):
 *  - `NotFailed()`           → state-precondition error
 *  - `NotAdmin()`            → caller is not the contract admin
 *  - `NotClaiming()`         → state-precondition error
 *  - `NotSetup()`            → state-precondition error
 *  - `NotFinalizing()`       → state-precondition error
 *  - `User rejected`         → wallet signature rejected
 *
 * Note: `gas limit too high` is intentionally NOT in the global map. It's an
 * RPC fallback话术 that maps to different real causes per function. Callers
 * should pass `customMap` with the right interpretation for their context.
 */
export function parseContractRevert(
  err: unknown,
  customMap?: Record<string, string>,
): string {
  const message = extractMessage(err);
  if (!message) return "Unknown error.";

  if (customMap) {
    for (const [pattern, friendly] of Object.entries(customMap)) {
      if (message.includes(pattern)) return friendly;
    }
  }

  for (const [pattern, friendly] of Object.entries(KNOWN_PATTERNS)) {
    if (message.includes(pattern)) return friendly;
  }

  return message;
}
