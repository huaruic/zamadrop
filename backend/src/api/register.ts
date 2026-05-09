import { Router } from "express";
import { z } from "zod";
import { createPublicClient, http, type Address, type Hash } from "viem";
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
  deployedTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
});

// Mirrors the on-chain `enum State { Setup, Finalizing, Claiming, Failed }`
// from contracts/ZamaDropCampaign.sol. Index by the uint8 returned from `state()`.
const STATE_BY_INDEX = ["setup", "finalizing", "claiming", "failed"] as const;

function mapChainState(raw: number | bigint): string {
  const idx = typeof raw === "bigint" ? Number(raw) : raw;
  if (idx < 0 || idx >= STATE_BY_INDEX.length) {
    throw new Error(`unknown chain state index ${idx}`);
  }
  return STATE_BY_INDEX[idx];
}

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
  const { address, admin, name, description, draftId, deployedTxHash } = parsed.data;
  const client = getPublicClient();
  const campaignAddress = address as Address;

  let chainAdmin: string;
  let chainAuditor: string;
  let chainToken: string;
  let chainHash: string;
  let chainDeclared: bigint;
  let chainCount: bigint;
  let chainStateRaw: number;
  try {
    const [a, au, tk, hash, declared, count, st] = await Promise.all([
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
      client.readContract({
        address: campaignAddress,
        abi: campaignAbi,
        functionName: "state",
      }) as Promise<number>,
    ]);
    chainAdmin = a;
    chainAuditor = au;
    chainToken = tk;
    chainHash = hash;
    chainDeclared = declared;
    chainCount = count;
    chainStateRaw = st;
  } catch (err) {
    return res.status(502).json({ error: "chain read failed", detail: String(err) });
  }

  if (chainAdmin.toLowerCase() !== admin.toLowerCase()) {
    return res.status(400).json({ error: "admin mismatch on-chain" });
  }

  let stateString: string;
  try {
    stateString = mapChainState(chainStateRaw);
  } catch (err) {
    return res.status(502).json({ error: "chain state unknown", detail: String(err) });
  }

  let deployedAtBlock: bigint;
  let deployedTxHashStored: string | null = null;
  if (deployedTxHash) {
    try {
      const receipt = await client.getTransactionReceipt({
        hash: deployedTxHash as Hash,
      });
      deployedAtBlock = receipt.blockNumber;
      deployedTxHashStored = deployedTxHash;
    } catch (err) {
      return res.status(502).json({ error: "tx receipt fetch failed", detail: String(err) });
    }
  } else {
    try {
      deployedAtBlock = await client.getBlockNumber();
    } catch (err) {
      return res.status(502).json({ error: "block tip fetch failed", detail: String(err) });
    }
  }

  const lastIndexedBlock = deployedAtBlock > 0n ? deployedAtBlock - 1n : 0n;

  await query(
    `INSERT INTO campaigns
       (address, admin, auditor, token, declared_total, recipient_count,
        recipient_list_hash, state, name, description,
        deployed_at_block, deployed_tx_hash, last_indexed_block)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (address) DO NOTHING`,
    [
      address,
      chainAdmin,
      chainAuditor,
      chainToken,
      chainDeclared.toString(),
      Number(chainCount),
      chainHash,
      stateString,
      name ?? null,
      description ?? null,
      deployedAtBlock.toString(),
      deployedTxHashStored,
      lastIndexedBlock.toString(),
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
