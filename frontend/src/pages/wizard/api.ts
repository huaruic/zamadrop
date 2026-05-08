/**
 * Drafts API client for the deployment wizard.
 *
 * Spec: openspec/changes/v7-dapp-wizard/specs/draft-encryption/spec.md
 *
 * `saveDraft` MUST envelope-encrypt `amounts` before they leave the browser:
 * the backend only ever sees `amountsCiphertext`, `amountsIv`, `wrappedDek`,
 * `wrappedDekIv`, `scopeJson`. Plaintext amounts are stripped from the body
 * before fetch. `loadDraft` is the inverse — if the response carries a
 * ciphertext, we decrypt with the same wallet signer + scope and return the
 * draft with plaintext amounts re-attached.
 *
 * Authorization is the Bearer token from `auth/siwe-client`. Cross-owner
 * access returns 404 (per spec, to avoid leaking existence). All fetch
 * failures throw with the HTTP status; UI wraps the error.
 */

import { authHeader, getSessionToken } from "@/auth/siwe-client";
import {
  decryptDraftAmounts,
  encryptDraftAmounts,
  type DraftCiphertext,
  type DraftScope,
  type SignerLike,
} from "@/lib/draft-crypto";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";

/** Subset of draft fields stored as plaintext on the backend. Everything
 * sensitive (amounts) lives in the envelope-encrypted block separately. */
export interface DraftPlaintextPayload {
  name?: string;
  description?: string;
  /** Recipient addresses live in plaintext per spec — they're public on chain
   * via AllocationSet events anyway. */
  recipientAddrs?: string[];
  auditor?: string;
  currentStep?: number;
  status?: string;
  campaignAddress?: string;
  /** uint64 amounts as bigint. Will be envelope-encrypted before send. */
  amounts?: bigint[];
}

/** Draft as returned by the backend GET. Optional ciphertext fields appear
 * iff `amounts` were ever saved. */
export interface DraftFetchResult {
  draftId: string;
  draftVersion: number;
  name: string | null;
  description: string | null;
  recipientAddrs: string[] | null;
  auditor: string | null;
  currentStep: number | null;
  status: string | null;
  campaignAddress: string | null;
  amountsCiphertext?: string | null;
  amountsIv?: string | null;
  wrappedDek?: string | null;
  wrappedDekIv?: string | null;
  scopeJson?: string | null;
  /** Decrypted amounts. Only populated when `loadDraft` succeeds against a
   * ciphertext-bearing draft. */
  amounts?: bigint[];
}

interface CreateDraftResponse {
  draftId: string;
  draftVersion: number;
}

function requireSession() {
  const token = getSessionToken();
  if (!token) {
    throw new Error("No SIWE session — sign in before saving drafts.");
  }
  return token;
}

async function jsonFetch<T>(
  path: string,
  init: RequestInit & { headers?: Record<string, string> },
): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} on ${path}: ${text}`);
  }
  // 204 No Content — no body to parse.
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

/** Create a new draft owned by the SIWE session address. */
export async function createDraft(name?: string): Promise<CreateDraftResponse> {
  requireSession();
  return jsonFetch<CreateDraftResponse>("/api/drafts", {
    method: "POST",
    headers: {
      ...authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: name ?? null }),
  });
}

/** Save partial draft state.
 *
 * If `payload.amounts` is present, envelope-encrypt and remove plaintext
 * amounts from the body. `expectedDraftVersion` enables optimistic locking
 * (backend bumps the version atomically and rejects stale writes). */
export async function saveDraft(
  draftId: string,
  payload: DraftPlaintextPayload,
  signer: SignerLike,
  scope: DraftScope,
  expectedDraftVersion?: number,
): Promise<{ draftVersion: number }> {
  requireSession();

  // Build the request body. Strip `amounts` — those go through the envelope
  // only. Convert plaintext fields to backend's snake_case.
  const body: Record<string, unknown> = {};
  if (payload.name !== undefined) body.name = payload.name;
  if (payload.description !== undefined) body.description = payload.description;
  if (payload.recipientAddrs !== undefined) {
    body.recipientAddrs = payload.recipientAddrs;
  }
  if (payload.auditor !== undefined) body.auditor = payload.auditor;
  if (payload.currentStep !== undefined) {
    body.currentStep = payload.currentStep;
  }
  if (payload.status !== undefined) body.status = payload.status;
  if (payload.campaignAddress !== undefined) {
    body.campaignAddress = payload.campaignAddress;
  }
  if (expectedDraftVersion !== undefined) {
    body.expectedDraftVersion = expectedDraftVersion;
  }

  if (payload.amounts !== undefined) {
    const ct: DraftCiphertext = await encryptDraftAmounts(
      payload.amounts,
      signer,
      scope,
    );
    body.amountsCiphertext = ct.amountsCiphertext;
    body.amountsIv = ct.amountsIv;
    body.wrappedDek = ct.wrappedDek;
    body.wrappedDekIv = ct.wrappedDekIv;
    body.scopeJson = ct.scopeJson;
  }

  return jsonFetch<{ draftVersion: number }>(`/api/drafts/${draftId}`, {
    method: "PUT",
    headers: {
      ...authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** Load a draft. If ciphertext fields are present, attempt to decrypt the
 * amounts using the provided signer + scope. Decryption failures throw
 * (e.g., wrong wallet, scope drift, tampered IV). */
export async function loadDraft(
  draftId: string,
  signer: SignerLike,
  scope: DraftScope,
): Promise<DraftFetchResult> {
  requireSession();
  const draft = await jsonFetch<DraftFetchResult>(`/api/drafts/${draftId}`, {
    method: "GET",
    headers: { ...authHeader() },
  });

  if (
    draft.amountsCiphertext &&
    draft.amountsIv &&
    draft.wrappedDek &&
    draft.wrappedDekIv
  ) {
    const ct: DraftCiphertext = {
      amountsCiphertext: draft.amountsCiphertext,
      amountsIv: draft.amountsIv,
      wrappedDek: draft.wrappedDek,
      wrappedDekIv: draft.wrappedDekIv,
      scopeJson: draft.scopeJson ?? "",
    };
    draft.amounts = await decryptDraftAmounts(ct, signer, scope);
  }

  return draft;
}
