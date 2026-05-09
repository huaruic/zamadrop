export type DirectoryPhase =
  | "Setup"
  | "Finalize-pending"
  | "Claiming"
  | "Failed"
  | "Cancelled"
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

export function phaseFromBackendState(state: string): DirectoryPhase {
  switch (state.toLowerCase()) {
    case "setup":
      return "Setup";
    case "finalizing":
      return "Finalize-pending";
    case "claiming":
      return "Claiming";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Loading";
  }
}

export function phaseLabel(phase: DirectoryPhase): string {
  switch (phase) {
    case "Setup":
      return "Pending";
    case "Finalize-pending":
      return "Verifying";
    case "Claiming":
      return "Live";
    case "Failed":
      return "Failed";
    case "Cancelled":
      return "Cancelled";
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
  return (
    phase === "Setup" ||
    phase === "Finalize-pending" ||
    phase === "Failed" ||
    phase === "Cancelled"
  );
}

export function phaseBadgeVariant(
  phase: DirectoryPhase,
): "default" | "cipher" | "success" | "muted" | "danger" {
  switch (phase) {
    case "Setup":
      return "default";
    case "Finalize-pending":
      return "cipher";
    case "Claiming":
      return "success";
    case "Failed":
      return "danger";
    case "Cancelled":
      return "muted";
    case "Loading":
      return "muted";
  }
}
