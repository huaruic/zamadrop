import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  decryptDraftAmounts,
  deriveScopeString,
  encryptDraftAmounts,
  type DraftScope,
  type SignerLike,
} from "./draft-crypto";

beforeAll(() => {
  // jsdom + recent Node already provides globalThis.crypto, but vitest's
  // default node environment may not. This makes the suite robust either way.
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    // @ts-expect-error — installing the standard webcrypto polyfill globally
    globalThis.crypto = webcrypto;
  }
});

/** Build a deterministic mock signer. signMessage(msg) returns a stable hex
 * derived from the message via SHA-256 — same message yields same signature
 * (round-trip works), and any change to the scope produces an entirely
 * different KEK (phishing/cross-draft tests fail to decrypt). */
function makeMockSigner(): SignerLike {
  return {
    signMessage: vi.fn(async (message: string): Promise<string> => {
      const data = new TextEncoder().encode(message);
      const hashA = new Uint8Array(
        await crypto.subtle.digest("SHA-256", data),
      );
      // 65-byte (130 hex char) ECDSA-shaped signature: two 32-byte halves
      // plus a recovery byte. Content doesn't have to be cryptographically
      // valid — only deterministic and message-dependent.
      const tag = new TextEncoder().encode(`${message}|second`);
      const hashB = new Uint8Array(
        await crypto.subtle.digest("SHA-256", tag),
      );
      const combined = new Uint8Array(65);
      combined.set(hashA, 0);
      combined.set(hashB, 32);
      combined[64] = 0x1b;
      let hex = "";
      for (const b of combined) hex += b.toString(16).padStart(2, "0");
      return `0x${hex}`;
    }),
  };
}

const baseScope: DraftScope = {
  chainId: 11155111,
  origin: "https://zamadrop.app",
  admin: "0x81f19692e5c59a7d7db7d0689843c213c9bfa260",
  draftId: "draft_A",
  createdAt: "2026-05-06T12:00:00Z",
  purpose: "wrap-draft-dek-v1",
};

describe("draft-crypto", () => {
  it("round-trip preserves amounts", async () => {
    const signer = makeMockSigner();
    const amounts = [5000n, 3000n, 8000n, 2n ** 60n];

    const ct = await encryptDraftAmounts(amounts, signer, baseScope);
    const decoded = await decryptDraftAmounts(ct, signer, baseScope);

    expect(decoded).toEqual(amounts);
  });

  it("two encryptions of the same data produce different IVs and ciphertexts", async () => {
    const signer = makeMockSigner();
    const amounts = [42n];

    const a = await encryptDraftAmounts(amounts, signer, baseScope);
    const b = await encryptDraftAmounts(amounts, signer, baseScope);

    expect(a.amountsIv).not.toBe(b.amountsIv);
    expect(a.wrappedDekIv).not.toBe(b.wrappedDekIv);
    expect(a.amountsCiphertext).not.toBe(b.amountsCiphertext);
    // wrappedDek also differs because (kek, iv) -> different ciphertext for
    // the freshly random DEK.
    expect(a.wrappedDek).not.toBe(b.wrappedDek);
  });

  it("phishing scope (different origin) cannot decrypt the real ciphertext", async () => {
    const signer = makeMockSigner();
    const amounts = [1234n];

    const real = await encryptDraftAmounts(amounts, signer, baseScope);

    const phishingScope: DraftScope = {
      ...baseScope,
      origin: "https://zamadr0p.app", // typo-squat
    };

    await expect(
      decryptDraftAmounts(real, signer, phishingScope),
    ).rejects.toThrow();
  });

  it("cross-draft scope (different draftId) cannot decrypt", async () => {
    const signer = makeMockSigner();
    const amounts = [777n];

    const ctA = await encryptDraftAmounts(amounts, signer, {
      ...baseScope,
      draftId: "draft_A",
    });

    await expect(
      decryptDraftAmounts(ctA, signer, {
        ...baseScope,
        draftId: "draft_B",
      }),
    ).rejects.toThrow();
  });

  it("scope string contains all fields in stable key order", () => {
    const s = deriveScopeString(baseScope);

    // Header line.
    expect(s.startsWith("ZamaDrop draft wrap key v1\n")).toBe(true);

    const json = s.slice("ZamaDrop draft wrap key v1\n".length);
    // Field order check: chainId before origin before admin before draftId
    // before createdAt before purpose. Use indexOf rather than parsing so we
    // catch silent reorderings of the JSON.stringify output too.
    const order = [
      "chainId",
      "origin",
      "admin",
      "draftId",
      "createdAt",
      "purpose",
    ];
    let prev = -1;
    for (const key of order) {
      const idx = json.indexOf(`"${key}"`);
      expect(idx).toBeGreaterThan(prev);
      prev = idx;
    }

    // All fields must be present.
    for (const key of order) {
      expect(json).toContain(`"${key}"`);
    }
    // Admin must be lowercased.
    expect(json).toContain(baseScope.admin.toLowerCase());
  });
});
