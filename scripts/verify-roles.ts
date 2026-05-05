/**
 * Verify roles + on-chain state for ZamaDrop campaign.
 *
 * Read-only — no transactions, no keys required for the read path. The
 * deployer signer (from PRIVATE_KEY) is identified to show "what role does
 * the running wallet have on this campaign". Useful for debugging role-page
 * gating in the frontend.
 *
 * Run: npx hardhat run scripts/verify-roles.ts --network sepolia
 */
import hre, { ethers } from "hardhat";
import deployment from "../deployments/sepolia.json";

const TOKEN = deployment.contracts.MockToken.address;
const CAMPAIGN = deployment.contracts.ZamaDropCampaign.address;
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

function shortAddr(addr: string) {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function shortHandle(h: string) {
  return h === ZERO ? "—" : `${h.slice(0, 10)}…${h.slice(-6)}`;
}

async function main() {
  const campaign = await ethers.getContractAt("ZamaDropCampaign", CAMPAIGN);
  const token = await ethers.getContractAt("MockToken", TOKEN);

  const [signer] = await ethers.getSigners();
  const me = signer.address;

  console.log("════════════════════════════════════════════════════════════");
  console.log("  ZamaDrop · Role + State Verification");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`network:  ${hre.network.name}`);
  console.log(`signer:   ${me}  ← the wallet running this script`);
  console.log(`campaign: ${CAMPAIGN}`);
  console.log(`token:    ${TOKEN}`);
  console.log("");

  // ── 1. Public campaign state ────────────────────────────────────
  const admin = await campaign.admin();
  const auditor = await campaign.auditor();
  const declaredTotal = await campaign.declaredTotal();
  const recipientCount = await campaign.recipientCount();
  const finalized = await campaign.finalized();
  const finalizeCheckHandle = await campaign.finalizeCheckHandle();
  const tokenAddr = await campaign.token();

  console.log("[1] Public campaign state");
  console.log(`    admin:                ${admin}`);
  console.log(`    auditor:              ${auditor}`);
  console.log(`    token:                ${tokenAddr}`);
  console.log(`    declaredTotal:        ${declaredTotal}`);
  console.log(`    recipientCount:       ${recipientCount}`);
  console.log(`    finalized:            ${finalized}`);
  console.log(`    finalizeCheckHandle:  ${shortHandle(finalizeCheckHandle)}`);

  // ── 2. Phase derivation (mirrors AdminPage logic) ────────────────
  let phase: string;
  if (finalized) phase = "Claiming";
  else if (finalizeCheckHandle === ZERO) phase = "Setup";
  else phase = "Finalize-pending";
  console.log(`    derived phase:        ${phase}`);
  console.log("");

  // ── 3. My role on this campaign ──────────────────────────────────
  const isAdmin = me.toLowerCase() === admin.toLowerCase();
  const isAuditor = me.toLowerCase() === auditor.toLowerCase();
  const isAllocSet = await campaign.allocationSet(me);
  const isClaimed = await campaign.claimed(me);
  const isTransferred = await campaign.transferred(me);

  console.log(`[2] Roles for signer wallet (${shortAddr(me)})`);
  console.log(`    isAdmin:              ${isAdmin}`);
  console.log(`    isAuditor:            ${isAuditor}`);
  console.log(`    isRecipient:          ${isAllocSet}  (allocationSet[me])`);
  console.log(`    claimed[me]:          ${isClaimed}`);
  console.log(`    transferred[me]:      ${isTransferred}`);
  const labels = [
    isAdmin && "Admin",
    isAuditor && "Auditor",
    isAllocSet && "Recipient",
  ].filter(Boolean);
  console.log(
    `    composite role:       ${labels.length ? labels.join(" + ") : "(none — public viewer only)"}`,
  );
  console.log("");

  // ── 4. All recipients + their per-address state ──────────────────
  const latestForEvents = await ethers.provider.getBlockNumber();
  const eventFromBlock = Math.max(0, latestForEvents - 49000);
  const allocFilter = campaign.filters.AllocationSet();
  const allocEvents = await campaign.queryFilter(
    allocFilter,
    eventFromBlock,
    "latest",
  );
  const recipients = Array.from(
    new Set(allocEvents.map((e: any) => e.args.recipient as string)),
  );

  console.log(`[3] Allocation ledger (${allocEvents.length} AllocationSet events)`);
  if (recipients.length === 0) {
    console.log("    (no allocations set yet — Admin hasn't called setAllocation)");
  } else {
    console.log(
      "    address                                       allocSet  claimed  transferred  pendingClaimHandle",
    );
    for (const r of recipients) {
      const setOk = await campaign.allocationSet(r);
      const claimOk = await campaign.claimed(r);
      const transOk = await campaign.transferred(r);
      const pending = await campaign.pendingClaimHandle(r);
      console.log(
        `    ${r}    ${String(setOk).padEnd(8)}  ${String(claimOk).padEnd(7)}  ${String(transOk).padEnd(11)}  ${shortHandle(pending)}`,
      );
    }
  }
  console.log("");

  // ── 5. Token escrow check ────────────────────────────────────────
  const escrow = await token.balanceOf(CAMPAIGN);
  const tokenSymbol = await token.symbol();
  console.log("[4] Token escrow");
  console.log(`    campaign balance:     ${escrow} ${tokenSymbol}`);
  console.log(`    declaredTotal:        ${declaredTotal} ${tokenSymbol}`);
  console.log(
    `    escrow ≥ declared:    ${escrow >= declaredTotal}  ← true means contract has enough to settle every claim`,
  );
  console.log("");

  // ── 6. Event timeline ────────────────────────────────────────────
  const latest = await ethers.provider.getBlockNumber();
  const fromBlock = Math.max(0, latest - 49000);
  console.log(
    `[5] Event timeline (last 49k blocks · from #${fromBlock} to #${latest})`,
  );
  const all = await campaign.queryFilter("*" as any, fromBlock, "latest");
  if (all.length === 0) {
    console.log("    (no events in window — campaign idle or pre-deploy)");
  } else {
    for (const ev of all) {
      const e: any = ev;
      const argsStr = e.args
        ? Object.entries(e.fragment?.inputs || [])
            .map(([_, input]: any, i: number) => {
              const v = e.args[i];
              const name = input?.name || `arg${i}`;
              return `${name}=${typeof v === "string" ? (v.length > 14 ? shortHandle(v) : v) : v}`;
            })
            .join(", ")
        : "";
      console.log(
        `    block ${e.blockNumber} · ${(e.eventName ?? e.fragment?.name ?? "?").padEnd(20)} · ${argsStr}`,
      );
    }
  }
  console.log("");

  // ── 7. Role-page expected behavior summary ───────────────────────
  console.log("[6] Frontend role-page gating expectation for this signer:");
  console.log(`    /campaign/${CAMPAIGN.slice(0, 6)}…${CAMPAIGN.slice(-4)}/admin   → ${isAdmin ? "WRITE-enabled (set + finalize)" : "read-only banner"}`);
  console.log(`    /campaign/${CAMPAIGN.slice(0, 6)}…${CAMPAIGN.slice(-4)}/me      → ${isAllocSet ? phase === "Claiming" && !isClaimed ? "Decrypt + Claim active" : isClaimed && !isTransferred ? "Awaiting settlement (executor)" : isTransferred ? "Done" : "Decrypt only (waiting for finalize)" : "No allocation banner"}`);
  console.log(`    /campaign/${CAMPAIGN.slice(0, 6)}…${CAMPAIGN.slice(-4)}/audit   → ${isAuditor ? "Aggregate decrypt active" : "Not the auditor banner"}`);
  console.log("");
  console.log("════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
