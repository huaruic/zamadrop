import { Router } from "express";
import { z } from "zod";
import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { query } from "../db/client.js";
import { config } from "../config.js";
import { campaignAbi } from "../chain/abi.js";

export const registerRouter = Router();

const body = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  admin: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  auditor: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  draftId: z.string().nullable().optional(),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

// Factory so tests can override the public client by mocking the module.
// At runtime we lazily build it once.
let publicClient: ReturnType<typeof createPublicClient> | null = null;
export function getPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: sepolia,
      transport: http(config.SEPOLIA_RPC),
    });
  }
  return publicClient;
}

/**
 * POST /api/register-campaign
 *
 * Wizard calls this immediately after a successful deploy. The handler
 * fetches authoritative values from chain via viem and rejects if the
 * caller-claimed admin doesn't match. Inserts a row in `campaigns` using
 * chain-verified values; cosmetic name/description come from the body.
 *
 * Idempotent on `address` (ON CONFLICT DO NOTHING) so a retry won't
 * duplicate rows. If `draftId` is provided we mark that draft as deployed.
 */
registerRouter.post("/register-campaign", async (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid body" });
  }
  const { address, admin, name, description, draftId } = parsed.data;
  const client = getPublicClient();
  const campaignAddress = address as Address;

  let chainAdmin: string;
  let chainAuditor: string;
  let chainToken: string;
  let chainHash: string;
  let chainDeclared: bigint;
  let chainCount: bigint;
  try {
    const [a, au, tk, hash, declared, count] = await Promise.all([
      client.readContract({
        address: campaignAddress,
        abi: campaignAbi,
        functionName: "admin",
      }) as Promise<string>,
      client.readContract({
        address: campaignAddress,
        abi: campaignAbi,
        functionName: "auditor",
      }) as Promise<string>,
      client.readContract({
        address: campaignAddress,
        abi: campaignAbi,
        functionName: "token",
      }) as Promise<string>,
      client.readContract({
        address: campaignAddress,
        abi: campaignAbi,
        functionName: "recipientListHash",
      }) as Promise<string>,
      client.readContract({
        address: campaignAddress,
        abi: campaignAbi,
        functionName: "declaredTotal",
      }) as Promise<bigint>,
      client.readContract({
        address: campaignAddress,
        abi: campaignAbi,
        functionName: "recipientCount",
      }) as Promise<bigint>,
    ]);
    chainAdmin = a;
    chainAuditor = au;
    chainToken = tk;
    chainHash = hash;
    chainDeclared = declared;
    chainCount = count;
  } catch (err) {
    return res.status(502).json({ error: "chain read failed", detail: String(err) });
  }

  if (chainAdmin.toLowerCase() !== admin.toLowerCase()) {
    return res.status(400).json({ error: "admin mismatch on-chain" });
  }

  await query(
    `INSERT INTO campaigns
       (address, admin, auditor, token, declared_total, recipient_count,
        recipient_list_hash, state, name, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'setup', $8, $9)
     ON CONFLICT (address) DO NOTHING`,
    [
      address,
      chainAdmin,
      chainAuditor,
      chainToken,
      chainDeclared.toString(),
      Number(chainCount),
      chainHash,
      name ?? null,
      description ?? null,
    ]
  );

  if (draftId) {
    await query(
      `UPDATE campaign_drafts
          SET status = 'deployed',
              campaign_address = $1,
              updated_at = NOW()
        WHERE draft_id = $2`,
      [address, draftId]
    );
  }

  return res.json({ ok: true });
});
