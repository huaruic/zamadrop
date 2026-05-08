import { createPublicClient, http, parseAbiItem, type Address, type Log } from "viem";
import { sepolia } from "viem/chains";
import { query } from "../db/client.js";
import { config } from "../config.js";

const POLL_INTERVAL_MS = 12_000;
const LAST_BLOCK_KEY = "indexer.last_block";

// Pre-parsed event ABIs for getLogs filtering.
const EVT_ALLOCATION_SET = parseAbiItem("event AllocationSet(address indexed recipient)");
const EVT_FINALIZED = parseAbiItem("event Finalized(bool success)");
const EVT_CLAIMED = parseAbiItem("event Claimed(address indexed recipient)");
const EVT_TOKEN_TRANSFERRED = parseAbiItem(
  "event TokenTransferred(address indexed user, uint64 amount)"
);

let client: ReturnType<typeof createPublicClient> | null = null;
function getClient() {
  if (!client) {
    client = createPublicClient({
      chain: sepolia,
      transport: http(config.SEPOLIA_RPC),
    });
  }
  return client;
}

async function readLastBlock(): Promise<bigint> {
  const rows = await query<{ value: string }>(
    "SELECT value FROM kv_state WHERE key = $1",
    [LAST_BLOCK_KEY]
  );
  if (rows.length === 0) return 0n;
  try {
    return BigInt(rows[0].value);
  } catch {
    return 0n;
  }
}

async function writeLastBlock(block: bigint): Promise<void> {
  await query(
    `INSERT INTO kv_state (key, value)
       VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [LAST_BLOCK_KEY, block.toString()]
  );
}

async function listKnownCampaigns(): Promise<Address[]> {
  const rows = await query<{ address: string }>(
    "SELECT address FROM campaigns"
  );
  return rows.map(r => r.address as Address);
}

async function handleAllocationSet(
  campaign: Address,
  log: Log & { args: { recipient?: string } }
) {
  const recipient = log.args.recipient;
  if (!recipient || log.blockNumber == null || !log.transactionHash) return;
  await query(
    `INSERT INTO allocations (campaign_address, recipient_address, block_number, tx_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (campaign_address, recipient_address) DO NOTHING`,
    [campaign, recipient, log.blockNumber.toString(), log.transactionHash]
  );
}

async function handleFinalized(
  campaign: Address,
  log: Log & { args: { success?: boolean } }
) {
  if (log.args.success !== true || log.blockNumber == null) return;
  await query(
    `UPDATE campaigns
        SET state = 'claiming',
            finalized_at_block = $2
      WHERE address = $1`,
    [campaign, log.blockNumber.toString()]
  );
}

async function handleClaimed(
  campaign: Address,
  log: Log & { args: { recipient?: string } }
) {
  const recipient = log.args.recipient;
  if (!recipient || log.blockNumber == null) return;
  // Idempotent UPSERT. Only refresh claimed_at_block when it was previously NULL,
  // so re-observing the same Claimed event doesn't overwrite a real value.
  await query(
    `INSERT INTO claims (campaign_address, user_address, claimed_at_block)
     VALUES ($1, $2, $3)
     ON CONFLICT (campaign_address, user_address) DO UPDATE
       SET claimed_at_block = COALESCE(claims.claimed_at_block, EXCLUDED.claimed_at_block)`,
    [campaign, recipient, log.blockNumber.toString()]
  );
}

async function handleTokenTransferred(
  campaign: Address,
  log: Log & { args: { user?: string; amount?: bigint } }
) {
  const user = log.args.user;
  const amount = log.args.amount;
  if (!user || amount == null || log.blockNumber == null) return;
  // Update existing claim row in-place. Idempotent: replaying the same event
  // overwrites the same fields with the same values (no accumulation).
  await query(
    `UPDATE claims
        SET amount = $1,
            transferred_at_block = $2
      WHERE campaign_address = $3
        AND LOWER(user_address) = LOWER($4)`,
    [amount.toString(), log.blockNumber.toString(), campaign, user]
  );
}

/**
 * One indexer tick:
 *   1. Read kv_state['indexer.last_block'] (default 0).
 *   2. Read current chain tip.
 *   3. For each known campaign address, fetch logs in (lastBlock, tip]
 *      for the four V7 events and dispatch to handlers.
 *   4. On success, persist tip as the new last_block.
 */
export async function indexerTick(): Promise<void> {
  const campaigns = await listKnownCampaigns();
  if (campaigns.length === 0) {
    return;
  }

  const c = getClient();
  const tip = await c.getBlockNumber();
  const lastBlock = await readLastBlock();
  if (tip <= lastBlock) {
    return;
  }
  const fromBlock = lastBlock + 1n;

  for (const campaign of campaigns) {
    const [allocLogs, finLogs, claimLogs, transferLogs] = await Promise.all([
      c.getLogs({
        address: campaign,
        event: EVT_ALLOCATION_SET,
        fromBlock,
        toBlock: tip,
      }),
      c.getLogs({
        address: campaign,
        event: EVT_FINALIZED,
        fromBlock,
        toBlock: tip,
      }),
      c.getLogs({
        address: campaign,
        event: EVT_CLAIMED,
        fromBlock,
        toBlock: tip,
      }),
      c.getLogs({
        address: campaign,
        event: EVT_TOKEN_TRANSFERRED,
        fromBlock,
        toBlock: tip,
      }),
    ]);

    for (const log of allocLogs) await handleAllocationSet(campaign, log as any);
    for (const log of finLogs) await handleFinalized(campaign, log as any);
    for (const log of claimLogs) await handleClaimed(campaign, log as any);
    for (const log of transferLogs) await handleTokenTransferred(campaign, log as any);
  }

  await writeLastBlock(tip);
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the polling loop. Errors in a single tick are logged and swallowed
 * so the worker keeps running through transient RPC blips.
 */
export function runIndexer(): void {
  if (timer) return; // idempotent
  const tick = async () => {
    try {
      await indexerTick();
    } catch (err) {
      console.error("[indexer] tick failed:", err);
    }
  };
  // Run once eagerly, then on interval.
  void tick();
  timer = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopIndexer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
