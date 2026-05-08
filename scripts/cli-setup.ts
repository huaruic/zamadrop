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

async function encryptAmount(
  contractAddress: string,
  senderAddress: string,
  value: bigint,
) {
  const input = hre.fhevm.createEncryptedInput(contractAddress, senderAddress);
  input.add64(value);
  const enc = await input.encrypt();
  return { handle: enc.handles[0], proof: enc.inputProof };
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

  // ─── 1. setAllocation × 2 ──────────────────────────────────────────
  const finalized0 = await campaign.finalized();
  if (finalized0) {
    console.log("Campaign already finalized — skipping setAllocation.");
  } else {
    const set1 = await campaign.allocationSet(admin.address);
    if (!set1) {
      console.log(`[1/4] setAllocation(${shortAddr(admin.address)}, ${RECIPIENT_1_AMOUNT})…`);
      const enc1 = await encryptAmount(CAMPAIGN, admin.address, RECIPIENT_1_AMOUNT);
      const tx1 = await campaign.connect(admin).setAllocation(admin.address, enc1.handle, enc1.proof);
      await tx1.wait();
      console.log(`      ✓ tx ${tx1.hash}`);
    } else {
      console.log(`[1/4] allocation already set for ${shortAddr(admin.address)} — skip`);
    }

    const set2 = await campaign.allocationSet(RECIPIENT_2_ADDR);
    if (!set2) {
      console.log(`[2/4] setAllocation(${shortAddr(RECIPIENT_2_ADDR)}, ${RECIPIENT_2_AMOUNT})…`);
      const enc2 = await encryptAmount(CAMPAIGN, admin.address, RECIPIENT_2_AMOUNT);
      const tx2 = await campaign.connect(admin).setAllocation(RECIPIENT_2_ADDR, enc2.handle, enc2.proof);
      await tx2.wait();
      console.log(`      ✓ tx ${tx2.hash}`);
    } else {
      console.log(`[2/4] allocation already set for ${shortAddr(RECIPIENT_2_ADDR)} — skip`);
    }

    // ─── 2. finalize() ────────────────────────────────────────────────
    console.log(`[3/4] finalize() — submits FHE.eq(runningTotal, declared) handle`);
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
      console.log("[4/4] already finalized — skip active-pull settlement");
    } else {
      console.log("[4/4] active-pull: hre.fhevm.publicDecrypt(finalizeCheckHandle)…");
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
