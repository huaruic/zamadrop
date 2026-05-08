import { describe, expect, it } from "vitest";

import {
  derivePhase,
  matchesFilter,
  phaseFilterLabel,
  phaseLabel,
} from "./phase";

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const NON_ZERO_HASH =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

describe("derivePhase", () => {
  it("returns Loading when finalized is undefined", () => {
    expect(derivePhase(undefined, undefined)).toBe("Loading");
  });

  it("returns Claiming when finalized is true", () => {
    expect(derivePhase(true, ZERO_HASH)).toBe("Claiming");
  });

  it("returns Setup when not finalized and no finalize handle", () => {
    expect(derivePhase(false, undefined)).toBe("Setup");
    expect(derivePhase(false, ZERO_HASH)).toBe("Setup");
  });

  it("returns Finalize-pending when not finalized but handle exists", () => {
    expect(derivePhase(false, NON_ZERO_HASH)).toBe("Finalize-pending");
  });
});

describe("phaseLabel", () => {
  it("maps internal phases to user-facing words", () => {
    expect(phaseLabel("Setup")).toBe("Pending");
    expect(phaseLabel("Finalize-pending")).toBe("Verifying");
    expect(phaseLabel("Claiming")).toBe("Live");
    expect(phaseLabel("Loading")).toBe("Loading");
  });
});

describe("phaseFilterLabel", () => {
  it("maps each filter value to its display word", () => {
    expect(phaseFilterLabel("all")).toBe("All");
    expect(phaseFilterLabel("live")).toBe("Live");
    expect(phaseFilterLabel("closed")).toBe("Closed");
  });
});

describe("matchesFilter", () => {
  it("all filter matches every phase", () => {
    expect(matchesFilter("Setup", "all")).toBe(true);
    expect(matchesFilter("Finalize-pending", "all")).toBe(true);
    expect(matchesFilter("Claiming", "all")).toBe(true);
    expect(matchesFilter("Loading", "all")).toBe(true);
  });

  it("live filter only matches Claiming", () => {
    expect(matchesFilter("Claiming", "live")).toBe(true);
    expect(matchesFilter("Setup", "live")).toBe(false);
    expect(matchesFilter("Finalize-pending", "live")).toBe(false);
    expect(matchesFilter("Loading", "live")).toBe(false);
  });

  it("closed filter matches Setup and Finalize-pending", () => {
    expect(matchesFilter("Setup", "closed")).toBe(true);
    expect(matchesFilter("Finalize-pending", "closed")).toBe(true);
    expect(matchesFilter("Claiming", "closed")).toBe(false);
    expect(matchesFilter("Loading", "closed")).toBe(false);
  });
});
