import { createPublicClient, http, parseAbiItem, type Address, type Log } from "viem";
import { sepolia } from "viem/chains";
import { query } from "../db/client.js";
import { config } from "../config.js";

const POLL_INTERVAL_MS = 12_000;

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

interface KnownCampaign {
  address: Address;
  lastIndexedBlock: bigint;
}

async function listKnownCampaigns(): Promise<KnownCampaign[]> {
  const rows = await query<{ address: string; last_indexed_block: string | number }>(
    "SELECT address, last_indexed_block FROM campaigns"
  );
  return rows.map(r => ({
    address: r.address as Address,
    lastIndexedBlock: BigInt(r.last_indexed_block),
  }));
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
  if (log.blockNumber == null) return;
  const success = log.args.success;
  if (success === true) {
    await query(
      `UPDATE campaigns
          SET state = 'claiming',
              finalized_at_block = $2
        WHERE address = $1`,
      [campaign, log.blockNumber.toString()]
    );
  } else if (success === false) {
    await query(
      `UPDATE campaigns
          SET state = 'failed',
              finalized_at_block = $2
        WHERE address = $1`,
      [campaign, log.blockNumber.toString()]
    );
  } else {
    console.warn(
      `[indexer] Finalized event for ${campaign} at block ${log.blockNumber} has missing success flag; skipping`
    );
  }
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

async function indexCampaign(
  campaign: KnownCampaign,
  tip: bigint
): Promise<void> {
  if (campaign.lastIndexedBlock >= tip) {
    return;
  }
  const fromBlock = campaign.lastIndexedBlock + 1n;
  const c = getClient();

  const [allocLogs, finLogs, claimLogs, transferLogs] = await Promise.all([
    c.getLogs({
      address: campaign.address,
      event: EVT_ALLOCATION_SET,
      fromBlock,
      toBlock: tip,
    }),
    c.getLogs({
      address: campaign.address,
      event: EVT_FINALIZED,
      fromBlock,
      toBlock: tip,
    }),
    c.getLogs({
      address: campaign.address,
      event: EVT_CLAIMED,
      fromBlock,
      toBlock: tip,
    }),
    c.getLogs({
      address: campaign.address,
      event: EVT_TOKEN_TRANSFERRED,
      fromBlock,
      toBlock: tip,
    }),
  ]);

  for (const log of allocLogs) await handleAllocationSet(campaign.address, log as Log & { args: { recipient?: string } });
  for (const log of finLogs) await handleFinalized(campaign.address, log as Log & { args: { success?: boolean } });
  for (const log of claimLogs) await handleClaimed(campaign.address, log as Log & { args: { recipient?: string } });
  for (const log of transferLogs) await handleTokenTransferred(campaign.address, log as Log & { args: { user?: string; amount?: bigint } });

  await query(
    `UPDATE campaigns SET last_indexed_block = $2 WHERE address = $1`,
    [campaign.address, tip.toString()]
  );
}

/**
 * One indexer tick:
 *   1. Read chain tip once.
 *   2. For each known campaign, scan (lastIndexedBlock, tip] for the four
 *      V7 events, dispatch handlers, and on success advance that campaign's
 *      cursor to tip. Per-campaign cursors mean a freshly-registered
 *      campaign starts from its own deploy block, not a stale global pointer.
 */
export async function indexerTick(): Promise<void> {
  const campaigns = await listKnownCampaigns();
  if (campaigns.length === 0) {
    return;
  }

  const c = getClient();
  const tip = await c.getBlockNumber();

  for (const campaign of campaigns) {
    try {
      await indexCampaign(campaign, tip);
    } catch (err) {
      console.error(`[indexer] campaign ${campaign.address} tick failed:`, err);
    }
  }
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
