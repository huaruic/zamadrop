/**
 * L1 (per-line) and L2 (whole-list) validation helpers for Step 2 of the
 * wizard.
 *
 * Spec: openspec/changes/v7-dapp-wizard/specs/admin-deployment-flow/spec.md
 *
 *   L1 SHALL reject:
 *     - non-0x non-.eth addresses
 *     - amounts that fail strict-uint64 (commas, exponents, decimals,
 *       negatives, overflow)
 *     - amount == 0
 *
 *   L2 SHALL reject:
 *     - empty list
 *     - sum == 0
 *     - sum > admin's ZDT balance
 *     - duplicate recipient addresses
 *
 * The L1 helper is line-oriented; UI calls it once per textarea row and
 * displays per-row errors. The L2 helper takes the parsed list and returns a
 * flat list of issues — UI shows them in a summary panel and disables Next
 * until the list is empty (of error-level items).
 */

import { isAddress } from "viem";

import { parseStrictUint64 } from "@/lib/parse";

import type { Recipient } from "./state";

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
}

export interface LineValidationResult {
  recipient: Recipient | null;
  issue?: ValidationIssue;
}

const ENS_REGEX = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i;

/** Parse a single textarea row of the form `<address> <amount>`. Whitespace
 * (any amount, tabs ok) separates the two tokens. Returns either a parsed
 * Recipient (with `displayInput` preserving the original token typed by the
 * user) or a typed validation issue. */
export function validateLineL1(line: string): LineValidationResult {
  const trimmed = line.trim();
  if (trimmed === "") {
    // Empty line — caller filters these out, no issue.
    return { recipient: null };
  }

  // Split on any whitespace. Multiple spaces collapse to one.
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2) {
    return {
      recipient: null,
      issue: {
        level: "error",
        message: `"${trimmed}" — expected "<address> <amount>"`,
      },
    };
  }
  if (tokens.length > 2) {
    return {
      recipient: null,
      issue: {
        level: "error",
        message: `"${trimmed}" — extra tokens after amount`,
      },
    };
  }

  const [addrToken, amountToken] = tokens;

  // Address: hex 0x-prefixed checks via viem. ENS-style ".eth" is structurally
  // recognized but deferred — MVP requires the user to resolve to 0x first.
  if (!isAddress(addrToken)) {
    if (ENS_REGEX.test(addrToken)) {
      return {
        recipient: null,
        issue: {
          level: "error",
          message: `"${addrToken}" — ENS names are not yet supported (use 0x address)`,
        },
      };
    }
    return {
      recipient: null,
      issue: {
        level: "error",
        message: `"${addrToken}" — invalid address (must be 0x + 40 hex)`,
      },
    };
  }
  // Lowercase to canonicalize for dedup checks; viem accepts both checksummed
  // and lowercase.
  const address = addrToken.toLowerCase() as `0x${string}`;

  let amount: bigint;
  try {
    amount = parseStrictUint64(amountToken);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      recipient: null,
      issue: {
        level: "error",
        message: `"${amountToken}" — ${reason}`,
      },
    };
  }
  if (amount === 0n) {
    return {
      recipient: null,
      issue: {
        level: "error",
        message: `"${addrToken}" — amount must be > 0`,
      },
    };
  }

  return {
    recipient: { address, displayInput: addrToken, amount },
  };
}

/** L2 list-level validation. Returns a flat list of issues; an empty array
 * means the list is OK to advance.
 *
 * `adminBalance` is read from the connected wallet's ZDT balanceOf. If
 * `undefined` (e.g., balance hasn't loaded yet), we skip the balance check
 * and emit a warning so the user knows the check was deferred. */
export function validateListL2(
  recipients: Recipient[],
  adminBalance: bigint | undefined,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (recipients.length === 0) {
    issues.push({
      level: "error",
      message: "Recipient list is empty.",
    });
    return issues;
  }

  // Duplicate detection — addresses are already canonicalized to lowercase
  // by validateLineL1, so a Set works.
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const r of recipients) {
    if (seen.has(r.address)) {
      dupes.add(r.address);
    }
    seen.add(r.address);
  }
  if (dupes.size > 0) {
    issues.push({
      level: "error",
      message: `Duplicate recipient(s): ${Array.from(dupes).join(", ")}`,
    });
  }

  // Sum check — both > 0 and ≤ admin balance.
  const sum = recipients.reduce((acc, r) => acc + r.amount, 0n);
  if (sum === 0n) {
    issues.push({
      level: "error",
      message: "Total allocation is 0.",
    });
  }

  if (adminBalance === undefined) {
    issues.push({
      level: "warning",
      message:
        "Wallet balance not yet loaded — the sum-vs-balance check will run before deploy.",
    });
  } else if (sum > adminBalance) {
    issues.push({
      level: "error",
      message: `Total ${sum.toString()} exceeds connected wallet's ZDT balance ${adminBalance.toString()}.`,
    });
  }

  return issues;
}

/** Convenience: parse a multi-line textarea blob into recipients + issues. */
export function parseRecipientList(blob: string): {
  recipients: Recipient[];
  lineIssues: { lineNumber: number; issue: ValidationIssue }[];
} {
  const recipients: Recipient[] = [];
  const lineIssues: { lineNumber: number; issue: ValidationIssue }[] = [];

  const rows = blob.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const result = validateLineL1(rows[i]);
    if (result.recipient) {
      recipients.push(result.recipient);
    } else if (result.issue) {
      lineIssues.push({ lineNumber: i + 1, issue: result.issue });
    }
  }

  return { recipients, lineIssues };
}
