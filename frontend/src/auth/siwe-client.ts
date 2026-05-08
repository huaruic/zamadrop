/**
 * SIWE (Sign-In With Ethereum, EIP-4361) login client.
 *
 * Flow:
 *   1. GET  /api/auth/nonce          — backend returns a one-shot random nonce
 *   2. Build a SiweMessage in-browser, ask wallet for personal_sign
 *   3. POST /api/auth/siwe           — backend ecrecover-verifies, issues JWT
 *   4. Persist JWT in localStorage   — Bearer auth on subsequent /api calls
 *
 * SIWE here is "anti-abuse + UX", NOT a privacy layer. Per the
 * `recipient-discovery` spec: anyone can replicate `/api/me/campaigns` by
 * indexing AllocationSet events directly. SIWE only gates *our convenience
 * API*; it does not hide the underlying chain data.
 */

import { SiweMessage } from "siwe";

const STORAGE_KEY = "zd:sessionToken";

/** Backend base URL. Defaults to localhost:3001 for dev. */
function backendUrl(): string {
  return import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
}

interface NonceResponse {
  nonce: string;
}

interface SiweLoginResponse {
  sessionToken: string;
}

/** Sign in via SIWE. Returns the issued session token (also persisted to localStorage).
 *
 * @param address      Connected wallet address (EIP-55 or lowercase)
 * @param signMessage  Wagmi `useSignMessage` async signer, returning the EIP-191 sig
 * @param chainId      EVM chain id (e.g. 11155111 for Sepolia)
 */
export async function siweLogin(
  address: `0x${string}`,
  signMessage: (args: { message: string }) => Promise<`0x${string}`>,
  chainId: number,
): Promise<string> {
  const base = backendUrl();

  // 1. Fetch nonce from backend.
  const nonceRes = await fetch(`${base}/api/auth/nonce`, {
    method: "GET",
    credentials: "omit",
  });
  if (!nonceRes.ok) {
    throw new Error(`SIWE nonce request failed: ${nonceRes.status}`);
  }
  const { nonce } = (await nonceRes.json()) as NonceResponse;

  // 2. Construct the human-readable SIWE message.
  const message = new SiweMessage({
    domain: window.location.host,
    address,
    statement:
      "Sign in to ZamaDrop. This signature does not authorize any transaction.",
    uri: window.location.origin,
    version: "1",
    chainId,
    nonce,
    issuedAt: new Date().toISOString(),
  });
  const messageString = message.prepareMessage();

  // 3. Ask wallet to sign.
  const signature = await signMessage({ message: messageString });

  // 4. Submit to backend for ecrecover + JWT issuance.
  const verifyRes = await fetch(`${base}/api/auth/siwe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: messageString, signature }),
  });
  if (!verifyRes.ok) {
    throw new Error(`SIWE verify failed: ${verifyRes.status}`);
  }
  const { sessionToken } = (await verifyRes.json()) as SiweLoginResponse;

  localStorage.setItem(STORAGE_KEY, sessionToken);
  return sessionToken;
}

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage unavailable — treat as already cleared */
  }
}

/** Build the standard `Authorization: Bearer <token>` header,
 * or an empty object if no session is present. */
export function authHeader(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
