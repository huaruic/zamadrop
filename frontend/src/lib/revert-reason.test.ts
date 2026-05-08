import { describe, expect, it } from "vitest";

import { parseContractRevert } from "./revert-reason";

describe("parseContractRevert", () => {
  it("maps known global patterns to friendly copy", () => {
    const err = new Error(
      'The contract function "cancelCampaign" reverted: NotFailed()',
    );
    expect(parseContractRevert(err)).toMatch(/not in Failed state/i);
  });

  it("recognizes NotAdmin", () => {
    const err = new Error("execution reverted: NotAdmin()");
    expect(parseContractRevert(err)).toMatch(/admin wallet/i);
  });

  it("recognizes wallet rejection", () => {
    const err = new Error("User rejected the request.");
    expect(parseContractRevert(err)).toMatch(/rejected/i);
  });

  it("prefers customMap over the global map", () => {
    const err = new Error(
      'The contract function "cancelCampaign" reverted: NotFailed()',
    );
    expect(
      parseContractRevert(err, {
        NotFailed: "Custom override message.",
      }),
    ).toBe("Custom override message.");
  });

  it("uses customMap for RPC fallback话术 like 'gas limit too high'", () => {
    const err = new Error(
      'The contract function "cancelCampaign" reverted with the following reason: gas limit too high',
    );
    expect(
      parseContractRevert(err, {
        "gas limit too high": "Refresh and verify state.",
      }),
    ).toBe("Refresh and verify state.");
  });

  it("falls back to raw message when nothing matches", () => {
    const raw = "some unknown viem error blob";
    const err = new Error(raw);
    expect(parseContractRevert(err)).toBe(raw);
  });

  it("accepts a plain string as input", () => {
    expect(parseContractRevert("NotClaiming()")).toMatch(/Claiming state/i);
  });

  it("returns 'Unknown error.' for undefined/null", () => {
    expect(parseContractRevert(undefined)).toBe("Unknown error.");
    expect(parseContractRevert(null)).toBe("Unknown error.");
  });

  it("returns 'Unknown error.' for empty string", () => {
    expect(parseContractRevert("")).toBe("Unknown error.");
  });

  it("handles non-Error objects without a message", () => {
    expect(parseContractRevert({ foo: "bar" })).toBeTypeOf("string");
  });
});
