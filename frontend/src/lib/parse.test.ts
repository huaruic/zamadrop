import { describe, expect, it } from "vitest";

import { parseStrictUint64 } from "./parse";

describe("parseStrictUint64", () => {
  it("accepts plain decimal digits", () => {
    expect(parseStrictUint64("5000")).toBe(5000n);
    expect(parseStrictUint64("0")).toBe(0n);
    expect(parseStrictUint64("1")).toBe(1n);
  });

  it("accepts the uint64 maximum value", () => {
    const max = (1n << 64n) - 1n;
    expect(parseStrictUint64(max.toString())).toBe(max);
  });

  it("rejects thousand-separator commas", () => {
    expect(() => parseStrictUint64("5,000")).toThrow(/invalid uint/);
  });

  it("rejects scientific / exponent notation", () => {
    expect(() => parseStrictUint64("5e3")).toThrow(/invalid uint/);
    expect(() => parseStrictUint64("1E10")).toThrow(/invalid uint/);
  });

  it("rejects negative numbers", () => {
    expect(() => parseStrictUint64("-5")).toThrow(/invalid uint/);
  });

  it("rejects empty string", () => {
    expect(() => parseStrictUint64("")).toThrow(/empty/);
  });

  it("rejects whitespace-padded input", () => {
    expect(() => parseStrictUint64("  5  ")).toThrow(/invalid uint/);
    expect(() => parseStrictUint64(" 5")).toThrow(/invalid uint/);
    expect(() => parseStrictUint64("5 ")).toThrow(/invalid uint/);
  });

  it("rejects values that overflow uint64", () => {
    // 2^64 = 18446744073709551616, which is one past UINT64_MAX
    expect(() => parseStrictUint64("18446744073709551616")).toThrow(
      /overflow/,
    );
  });

  it("rejects decimal-pointed inputs", () => {
    expect(() => parseStrictUint64("5.0")).toThrow(/invalid uint/);
    expect(() => parseStrictUint64("0.5")).toThrow(/invalid uint/);
  });
});
