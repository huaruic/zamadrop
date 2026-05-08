/**
 * CLI E2E driver for ZamaDrop. Drives the full admin + recipient + auditor
 * lifecycle from the command line. This script actively pulls KMS via
 * `hre.fhevm.publicDecrypt` and self-submits the callbacks (no off-chain
 * settlement service required).
 *
 * This is what you'd see in the browser if you clicked through Admin tab
 * → Recipient tab → Auditor tab — minus the EIP-712 wallet popups.
 *
 * Run: npx hardhat run scripts/cli-setup.ts --network sepolia
 */
import hre, { ethers } from "hardhat";
import { FhevmType } from "@fhevm/mock-utils";
import deployment from "../deployments/sepolia.json";

const CAMPAIGN = deployment.contracts.ZamaDropCampaign.address;
const TOKEN = deployment.contracts.MockToken.address;

const RECIPIENT_1_AMOUNT = 600n; // assigned to deployer (= admin = auditor here)
const RECIPIENT_2_AMOUNT = 400n; // assigned to dEaD (will never claim — sum=1000 holds)
const RECIPIENT_2_ADDR = "0x000000000000000000000000000000000000dEaD";

const ZERO_HANDLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

function shortAddr(a: string) {
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

/** Maximum recipients per setAllocationsBatch call. Mirrors the frontend
 * wizard's BATCH_SIZE (HCU-bounded). See AGENTS.md invariant #4 and
 * frontend/src/pages/wizard/deploy.ts. */
const BATCH_SIZE = 16;

async function encryptAmountsBatch(
  contractAddress: string,
  senderAddress: string,
  values: bigint[],
) {
  const input = hre.fhevm.createEncryptedInput(contractAddress, senderAddress);
  for (const v of values) input.add64(v);
  const enc = await input.encrypt();
  return { handles: enc.handles, proof: enc.inputProof };
}

type RecipientAlloc = { address: string; amount: bigint };

/** Set allocations via the batched primitive, mirroring frontend
 * `setAllocationsBatched` in deploy.ts. Filters already-set recipients
 * (idempotent resume), then chunks into ≤ BATCH_SIZE batches. Exercises
 * the same ABI path the wizard uses, so any contract regression that
 * affects the batch primitive surfaces equally in CLI runs. */
async function setAllocationsBatched(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  campaign: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  recipients: RecipientAlloc[],
): Promise<void> {
  const pending: RecipientAlloc[] = [];
  for (const r of recipients) {
    if (await campaign.allocationSet(r.address)) {
      console.log(`      already set for ${shortAddr(r.address)} — skip`);
    } else {
      pending.push(r);
    }
  }
  if (pending.length === 0) return;

  const totalBatches = Math.ceil(pending.length / BATCH_SIZE);
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const chunk = pending.slice(i, i + BATCH_SIZE);
    const batchIdx = Math.floor(i / BATCH_SIZE) + 1;
    console.log(
      `      batch ${batchIdx}/${totalBatches} — encrypting ${chunk.length} amounts`,
    );
    const { handles, proof } = await encryptAmountsBatch(
      CAMPAIGN,
      admin.address,
      chunk.map((r) => r.amount),
    );
    const tx = await campaign
      .connect(admin)
      .setAllocationsBatch(
        chunk.map((r) => r.address),
        handles,
        proof,
      );
    await tx.wait();
    console.log(`      ✓ tx ${tx.hash}`);
  }
}

async function main() {
  await hre.fhevm.initializeCLIApi();

  const [admin] = await ethers.getSigners();
  const campaign = await ethers.getContractAt("ZamaDropCampaign", CAMPAIGN);
  const token = await ethers.getContractAt("MockToken", TOKEN);

  console.log("════════════════════════════════════════════════════════════");
  console.log("  ZamaDrop · CLI E2E driver");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`network:  ${hre.network.name}`);
  console.log(`signer:   ${admin.address} (admin = auditor = recipient1)`);
  console.log(`campaign: ${CAMPAIGN}`);
  console.log("");

  // ─── 1. setAllocationsBatch ────────────────────────────────────────
  // CLI mirrors the wizard's batch path (frontend setAllocationsBatched in
  // deploy.ts) so a single ABI surface covers both flows. At N=2 the helper
  // produces one batched tx instead of two single-call txs — same on-chain
  // semantics, half the wallet/gas cost.
  const finalized0 = await campaign.finalized();
  if (finalized0) {
    console.log("Campaign already finalized — skipping setAllocation.");
  } else {
    console.log(`[1/3] setAllocationsBatch — 2 recipients`);
    await setAllocationsBatched(campaign, admin, [
      { address: admin.address, amount: RECIPIENT_1_AMOUNT },
      { address: RECIPIENT_2_ADDR, amount: RECIPIENT_2_AMOUNT },
    ]);

    // ─── 2. finalize() ────────────────────────────────────────────────
    console.log(`[2/3] finalize() — submits FHE.eq(runningTotal, declared) handle`);
    const handleBefore = await campaign.finalizeCheckHandle();
    if (handleBefore === ZERO_HANDLE) {
      const txF = await campaign.connect(admin).finalize();
      await txF.wait();
      console.log(`      ✓ tx ${txF.hash}`);
    } else {
      console.log(`      handle already emitted — skip submit`);
    }

    // ─── 3. active-pull KMS + self-submit callbackFinalize ────────────
    const finalizedNow = await campaign.finalized();
    if (finalizedNow) {
      console.log("[3/3] already finalized — skip active-pull settlement");
    } else {
      console.log("[3/3] active-pull: hre.fhevm.publicDecrypt(finalizeCheckHandle)…");
      const checkHandle = await campaign.finalizeCheckHandle();
      const decryptedFinalize = await hre.fhevm.publicDecrypt([checkHandle]);
      const sumCheck = decryptedFinalize.clearValues[checkHandle] as boolean;
      console.log(`      sumCheck = ${sumCheck} (${sumCheck ? "matches → Claiming" : "mismatch → Failed"})`);
      const txCb = await campaign.connect(admin).callbackFinalize(sumCheck, decryptedFinalize.decryptionProof);
      await txCb.wait();
      console.log(`      ✓ callbackFinalize tx ${txCb.hash}`);
      const stateAfter = Number(await campaign.state());
      if (stateAfter === 2) {
        console.log("      ✓ settled — campaign now in Claiming phase");
      } else if (stateAfter === 3) {
        console.log("      ⚠ KMS reported sum mismatch — campaign moved to Failed");
      } else {
        console.log(`      ⚠ unexpected state ${stateAfter} after callbackFinalize`);
      }
    }
  }
  console.log("");

  // ─── 4. recipient userDecrypt of own allocation ────────────────────
  console.log("─── recipient flow (admin wallet acts as recipient1 in this demo) ───");
  console.log("[recipient] requestMyAllocation()…");
  const myHandle = await campaign.connect(admin).requestMyAllocation();
  console.log(`             handle = ${myHandle}`);
  console.log("[recipient] userDecrypt(euint64) — proves only this wallet can read…");
  const myAmount = await hre.fhevm.userDecryptEuint(
    FhevmType.euint64,
    myHandle,
    CAMPAIGN,
    admin,
  );
  console.log(`             decrypted: ${myAmount} ZDT`);
  console.log("");

  // ─── 5. claim ──────────────────────────────────────────────────────
  const alreadyClaimed = await campaign.claimed(admin.address);
  if (alreadyClaimed) {
    console.log("[claim] already claimed — skipping");
  } else {
    console.log("[claim] submitting claim()…");
    const txC = await campaign.connect(admin).claim();
    await txC.wait();
    console.log(`        ✓ tx ${txC.hash}`);
  }

  // ─── 6. active-pull KMS + self-submit executeTransfer ──────────────
  const alreadyTransferred = await campaign.transferred(admin.address);
  if (alreadyTransferred) {
    console.log("[claim] already transferred — skip active-pull settlement");
  } else {
    console.log("[claim] active-pull: hre.fhevm.publicDecrypt(pendingClaimHandle)…");
    const claimHandle = await campaign.pendingClaimHandle(admin.address);
    const decryptedClaim = await hre.fhevm.publicDecrypt([claimHandle]);
    const amount = decryptedClaim.clearValues[claimHandle] as bigint;
    console.log(`        decrypted amount = ${amount} ZDT`);
    const txT = await campaign
      .connect(admin)
      .executeTransfer(admin.address, amount, decryptedClaim.decryptionProof);
    await txT.wait();
    console.log(`        ✓ executeTransfer tx ${txT.hash} — settled`);
  }

  const balance = await token.balanceOf(admin.address);
  console.log(`[claim] ERC20 balance: ${balance} ZDT  ← real tokens in your wallet`);
  console.log("");

  // ─── 7. auditor view ───────────────────────────────────────────────
  console.log("─── auditor flow ───");
  console.log("[auditor] requestClaimedTotalForAuditor() + userDecrypt…");
  const aggHandle = await campaign.connect(admin).requestClaimedTotalForAuditor();
  const claimedTotal = await hre.fhevm.userDecryptEuint(
    FhevmType.euint64,
    aggHandle,
    CAMPAIGN,
    admin,
  );
  const declared = await campaign.declaredTotal();
  const pct = (Number((claimedTotal * 10000n) / declared) / 100).toFixed(1);
  console.log(`          claimed_total = ${claimedTotal} ZDT  (${pct}% of declared)`);
  console.log("          ↑ aggregate only — auditor cannot decrypt any individual allocation");
  console.log("");

  // ─── 8. final summary ──────────────────────────────────────────────
  console.log("════════════════════════════════════════════════════════════");
  console.log("  E2E flow complete ✓");
  console.log("");
  console.log("  Lifecycle traversed:");
  console.log("    Setup → Finalize-pending → Claiming → Done");
  console.log("");
  console.log("  Active-pull settlement handled:");
  console.log("    finalizeCheckHandle → publicDecrypt → callbackFinalize");
  console.log("    pendingClaimHandle  → publicDecrypt → executeTransfer");
  console.log("");
  console.log("  Trust root: Zama threshold KMS signatures (FHE.checkSignatures).");
  console.log("════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
