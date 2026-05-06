import { Router } from "express";
import { query } from "../db/client.js";
import { requireSession, type SessionRequest } from "../auth/session.js";

export const campaignsRouter = Router();

interface CampaignRow {
  address: string;
  admin: string;
  auditor: string;
  token: string;
  declared_total: string;
  recipient_count: number;
  recipient_list_hash: string;
  state: string;
  name: string | null;
  description: string | null;
  deployed_at_block: string | null;
  deployed_tx_hash: string | null;
  finalized_at_block: string | null;
  created_at: Date;
}

function rowToCampaign(row: CampaignRow) {
  return {
    address: row.address,
    admin: row.admin,
    auditor: row.auditor,
    token: row.token,
    declaredTotal: row.declared_total,
    recipientCount: row.recipient_count,
    recipientListHash: row.recipient_list_hash,
    state: row.state,
    name: row.name,
    description: row.description,
    deployedAtBlock: row.deployed_at_block,
    deployedTxHash: row.deployed_tx_hash,
    finalizedAtBlock: row.finalized_at_block,
    createdAt: row.created_at,
  };
}

/**
 * GET /api/campaigns?status=
 *
 * Public listing of all known campaigns. Optional `status` filter narrows by
 * lifecycle state ("setup", "claiming", ...). Always returns newest-first.
 */
campaignsRouter.get("/campaigns", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const rows = status
    ? await query<CampaignRow>(
        "SELECT * FROM campaigns WHERE state = $1 ORDER BY created_at DESC",
        [status]
      )
    : await query<CampaignRow>(
        "SELECT * FROM campaigns ORDER BY created_at DESC"
      );
  res.json(rows.map(rowToCampaign));
});

/**
 * GET /api/admin/:address/campaigns
 *
 * Public list of campaigns where `admin = address` (case-insensitive).
 */
campaignsRouter.get("/admin/:address/campaigns", async (req, res) => {
  const address = req.params.address.toLowerCase();
  const rows = await query<CampaignRow>(
    "SELECT * FROM campaigns WHERE LOWER(admin) = $1 ORDER BY created_at DESC",
    [address]
  );
  res.json(rows.map(rowToCampaign));
});

/**
 * GET /api/auditor/:address/campaigns
 *
 * Public list of campaigns where `auditor = address` (case-insensitive).
 */
campaignsRouter.get("/auditor/:address/campaigns", async (req, res) => {
  const address = req.params.address.toLowerCase();
  const rows = await query<CampaignRow>(
    "SELECT * FROM campaigns WHERE LOWER(auditor) = $1 ORDER BY created_at DESC",
    [address]
  );
  res.json(rows.map(rowToCampaign));
});

/**
 * POST /api/me/campaigns
 *
 * SIWE-gated. Returns campaigns where the caller's address appears in
 * `allocations.recipient_address`. Used by the recipient self-discovery flow.
 */
campaignsRouter.post(
  "/me/campaigns",
  requireSession,
  async (req: SessionRequest, res) => {
    const address = req.session!.address; // already lowercase from session
    const rows = await query<CampaignRow>(
      `SELECT DISTINCT c.*
         FROM campaigns c
         INNER JOIN allocations a
                 ON a.campaign_address = c.address
        WHERE LOWER(a.recipient_address) = $1
        ORDER BY c.created_at DESC`,
      [address]
    );
    res.json(rows.map(rowToCampaign));
  }
);
