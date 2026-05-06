import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "../db/client.js";
import { requireSession, type SessionRequest } from "../auth/session.js";

export const draftsRouter = Router();

interface DraftRow {
  draft_id: string;
  owner_address: string;
  current_step: number;
  status: string;
  campaign_address: string | null;
  draft_version: number;
  name: string | null;
  description: string | null;
  auditor_address: string | null;
  recipient_addrs: unknown;
  amounts_ciphertext: string | null;
  amounts_iv: string | null;
  wrapped_dek: string | null;
  wrapped_dek_iv: string | null;
  scope_json: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToDraft(row: DraftRow) {
  return {
    draftId: row.draft_id,
    ownerAddress: row.owner_address,
    currentStep: row.current_step,
    status: row.status,
    campaignAddress: row.campaign_address,
    draftVersion: row.draft_version,
    name: row.name,
    description: row.description,
    auditorAddress: row.auditor_address,
    recipientAddrs: row.recipient_addrs,
    amountsCiphertext: row.amounts_ciphertext,
    amountsIv: row.amounts_iv,
    wrappedDek: row.wrapped_dek,
    wrappedDekIv: row.wrapped_dek_iv,
    scopeJson: row.scope_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const createBody = z.object({
  name: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

/**
 * POST /api/drafts
 *
 * SIWE-gated. Creates a new draft owned by the session address, with a
 * server-generated draft_id and version 1.
 */
draftsRouter.post("/drafts", requireSession, async (req: SessionRequest, res) => {
  const parsed = createBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid body" });
  }
  const owner = req.session!.address;
  const draftId = `draft_${randomUUID()}`;
  const rows = await query<DraftRow>(
    `INSERT INTO campaign_drafts
       (draft_id, owner_address, current_step, status, draft_version, name, description)
     VALUES ($1, $2, 1, 'draft', 1, $3, $4)
     RETURNING *`,
    [draftId, owner, parsed.data.name ?? null, parsed.data.description ?? null]
  );
  return res.status(201).json(rowToDraft(rows[0]));
});

/**
 * GET /api/drafts/:id
 *
 * SIWE-gated. Returns the draft only if the session address matches the
 * stored owner. Cross-owner access returns 404 (not 403) per recipient-discovery
 * spec, to avoid leaking draft existence.
 */
draftsRouter.get("/drafts/:id", requireSession, async (req: SessionRequest, res) => {
  const owner = req.session!.address;
  const rows = await query<DraftRow>(
    "SELECT * FROM campaign_drafts WHERE draft_id = $1 AND LOWER(owner_address) = $2",
    [req.params.id, owner]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: "not found" });
  }
  return res.json(rowToDraft(rows[0]));
});

// camelCase → snake_case whitelist for PUT.
// Map keys are the API field names; values are the DB column names.
const FIELD_MAP: Record<string, string> = {
  name: "name",
  description: "description",
  currentStep: "current_step",
  auditorAddress: "auditor_address",
  recipientAddrs: "recipient_addrs",
  amountsCiphertext: "amounts_ciphertext",
  amountsIv: "amounts_iv",
  wrappedDek: "wrapped_dek",
  wrappedDekIv: "wrapped_dek_iv",
  scopeJson: "scope_json",
  status: "status",
  campaignAddress: "campaign_address",
};

/**
 * PUT /api/drafts/:id
 *
 * SIWE-gated. Updates whitelisted fields (camelCase → snake_case) and bumps
 * `draft_version`. Supports optional optimistic locking via
 * `expectedDraftVersion`: if present and stale, responds 409 with current
 * version + lastUpdatedAt.
 */
draftsRouter.put("/drafts/:id", requireSession, async (req: SessionRequest, res) => {
  const owner = req.session!.address;
  const body = (req.body ?? {}) as Record<string, unknown>;

  // First, locate the row scoped to owner. 404 on miss/owner-mismatch.
  const existing = await query<DraftRow>(
    "SELECT * FROM campaign_drafts WHERE draft_id = $1 AND LOWER(owner_address) = $2",
    [req.params.id, owner]
  );
  if (existing.length === 0) {
    return res.status(404).json({ error: "not found" });
  }
  const current = existing[0];

  // Optimistic lock check. If the client supplies expectedDraftVersion and it
  // doesn't match, reject with the current state so the UI can show a conflict
  // dialog. If omitted, fall through to the no-lock path for backward compat.
  const expected = body.expectedDraftVersion;
  if (typeof expected === "number" && expected !== current.draft_version) {
    return res.status(409).json({
      error: "draft version conflict",
      currentDraftVersion: current.draft_version,
      lastUpdatedAt: current.updated_at,
    });
  }

  // Build dynamic SET clause from whitelisted keys only. Unknown keys
  // (e.g. owner_address, draft_id, draft_version) are silently dropped.
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const [apiKey, column] of Object.entries(FIELD_MAP)) {
    if (apiKey in body) {
      let v = body[apiKey];
      // recipient_addrs is JSONB; serialize arrays/objects so pg sends JSON.
      if (column === "recipient_addrs" && v !== null && typeof v !== "string") {
        v = JSON.stringify(v);
      }
      setClauses.push(`${column} = $${idx++}`);
      values.push(v);
    }
  }
  setClauses.push("draft_version = draft_version + 1");
  setClauses.push("updated_at = NOW()");

  values.push(req.params.id, owner);
  const rows = await query<DraftRow>(
    `UPDATE campaign_drafts
        SET ${setClauses.join(", ")}
      WHERE draft_id = $${idx++} AND LOWER(owner_address) = $${idx++}
   RETURNING *`,
    values
  );
  if (rows.length === 0) {
    // Race: deleted between SELECT and UPDATE. Treat as not-found.
    return res.status(404).json({ error: "not found" });
  }
  return res.json(rowToDraft(rows[0]));
});

/**
 * DELETE /api/drafts/:id
 *
 * SIWE-gated. Owner-scoped delete; cross-owner returns 204 silently as well
 * since the row was effectively "not visible" to the caller; a stricter 404
 * would also be acceptable but we mirror REST convention here.
 */
draftsRouter.delete("/drafts/:id", requireSession, async (req: SessionRequest, res) => {
  const owner = req.session!.address;
  await query(
    "DELETE FROM campaign_drafts WHERE draft_id = $1 AND LOWER(owner_address) = $2",
    [req.params.id, owner]
  );
  return res.status(204).end();
});
