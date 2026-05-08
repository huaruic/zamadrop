// Client-side draft envelope encryption.
//
// Draft amounts MUST never reach the server in plaintext. We use a DEK+KEK
// envelope:
//   - DEK: 256-bit random key, fresh per draft. Encrypts the JSON-serialized
//     amounts list with AES-GCM (96-bit IV per save).
//   - KEK: derived from a wallet signature over a scope-bound message. Wraps
//     the DEK with AES-GCM (separate 96-bit IV).
//
// Scope binding (chainId, origin, admin, draftId, createdAt, purpose) prevents
// a signature obtained on a phishing origin or a different draft from
// decrypting the real ciphertext.
//
// IV reuse is catastrophic for AES-GCM, so each call to `encryptDraftAmounts`
// generates fresh IVs for both encryptions. There is a unit test asserting
// this property.

import { gcm } from "@noble/ciphers/aes.js";
import {
  bytesToUtf8,
  hexToBytes,
  utf8ToBytes,
} from "@noble/ciphers/utils.js";

export interface DraftScope {
  chainId: number;
  origin: string;
  admin: string;
  draftId: string;
  createdAt: string;
  purpose: string;
}

export interface DraftCiphertext {
  amountsCiphertext: string;
  amountsIv: string;
  wrappedDek: string;
  wrappedDekIv: string;
  scopeJson: string;
}

export interface SignerLike {
  signMessage(message: string): Promise<string>;
}

/** Build the message string the wallet signs to derive the KEK.
 *
 * Field order in the JSON object is fixed so that the same scope object
 * always produces the same signature payload regardless of how callers
 * construct it. Address is lowercased to be checksum-insensitive. */
export function deriveScopeString(scope: DraftScope): string {
  const ordered = {
    chainId: scope.chainId,
    origin: scope.origin,
    admin: scope.admin.toLowerCase(),
    draftId: scope.draftId,
    createdAt: scope.createdAt,
    purpose: scope.purpose,
  };
  return `ZamaDrop draft wrap key v1\n${JSON.stringify(ordered)}`;
}

async function deriveKEK(
  signer: SignerLike,
  scope: DraftScope,
): Promise<Uint8Array> {
  const message = deriveScopeString(scope);
  const signature = await signer.signMessage(message);
  const sigBytes = signature.startsWith("0x")
    ? hexToBytes(signature.slice(2))
    : utf8ToBytes(signature);
  const hash = await crypto.subtle.digest("SHA-256", sigBytes);
  return new Uint8Array(hash);
}

export async function encryptDraftAmounts(
  amounts: bigint[],
  signer: SignerLike,
  scope: DraftScope,
): Promise<DraftCiphertext> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const amountsIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedDekIv = crypto.getRandomValues(new Uint8Array(12));

  const plaintext = utf8ToBytes(
    JSON.stringify(amounts.map((a) => a.toString())),
  );
  const ciphertext = gcm(dek, amountsIv).encrypt(plaintext);

  const kek = await deriveKEK(signer, scope);
  const wrappedDek = gcm(kek, wrappedDekIv).encrypt(dek);

  // Best-effort wipe; JS gives no real guarantees, but it removes the obvious
  // long-lived references.
  dek.fill(0);
  kek.fill(0);

  return {
    amountsCiphertext: bytesToBase64(ciphertext),
    amountsIv: bytesToBase64(amountsIv),
    wrappedDek: bytesToBase64(wrappedDek),
    wrappedDekIv: bytesToBase64(wrappedDekIv),
    scopeJson: deriveScopeString(scope),
  };
}

export async function decryptDraftAmounts(
  encrypted: DraftCiphertext,
  signer: SignerLike,
  scope: DraftScope,
): Promise<bigint[]> {
  const kek = await deriveKEK(signer, scope);
  const wrappedDekIv = base64ToBytes(encrypted.wrappedDekIv);
  const wrappedDek = base64ToBytes(encrypted.wrappedDek);
  const dek = gcm(kek, wrappedDekIv).decrypt(wrappedDek);

  const amountsIv = base64ToBytes(encrypted.amountsIv);
  const amountsCiphertext = base64ToBytes(encrypted.amountsCiphertext);
  const plaintext = gcm(dek, amountsIv).decrypt(amountsCiphertext);

  dek.fill(0);
  kek.fill(0);

  const parsed = JSON.parse(bytesToUtf8(plaintext)) as string[];
  return parsed.map((s) => BigInt(s));
}

function bytesToBase64(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
