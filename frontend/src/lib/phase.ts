export type DirectoryPhase =
  | "Setup"
  | "Finalize-pending"
  | "Claiming"
  | "Loading";

export type StatusFilter = "all" | "live" | "closed";

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export function derivePhase(
  finalized: boolean | undefined,
  finalizeCheckHandle: `0x${string}` | undefined,
): DirectoryPhase {
  if (finalized === undefined) return "Loading";
  if (finalized) return "Claiming";
  return !finalizeCheckHandle || finalizeCheckHandle === ZERO_HASH
    ? "Setup"
    : "Finalize-pending";
}

export function phaseLabel(phase: DirectoryPhase): string {
  switch (phase) {
    case "Setup":
      return "Pending";
    case "Finalize-pending":
      return "Verifying";
    case "Claiming":
      return "Live";
    case "Loading":
      return "Loading";
  }
}

export function phaseFilterLabel(filter: StatusFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "live":
      return "Live";
    case "closed":
      return "Closed";
  }
}

export function matchesFilter(
  phase: DirectoryPhase,
  filter: StatusFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "live") return phase === "Claiming";
  return phase === "Setup" || phase === "Finalize-pending";
}

export function phaseBadgeVariant(
  phase: DirectoryPhase,
): "default" | "cipher" | "success" | "muted" {
  switch (phase) {
    case "Setup":
      return "default";
    case "Finalize-pending":
      return "cipher";
    case "Claiming":
      return "success";
    case "Loading":
      return "muted";
  }
}
