/**
 * End-to-end verification of the Failed-state recovery path.
 *
 * Layer 4 in the verification ladder (see docs/VERIFICATION.md):
 *   1. Reproduces a State.Failed campaign (same logic as trigger-failed.ts)
 *   2. Drives admin's cancelCampaign() directly via signer (substitutes for
 *      the UI button click in CancelCampaignForm)
 *   3. Asserts the recovery invariants:
 *        - state stays Failed (cancelCampaign does NOT change state, only
 *          transfers escrow back)
 *        - campaign token balance == 0
 *        - admin token balance increased by the recovered amount
 *        - CampaignCancelled event emitted with returnedAmount
 *   4. Negative test: non-admin caller is reverted with NotAdmin
 *   5. Idempotency: calling cancelCampaign() again succeeds with returnedAmount=0
 *
 * Run:
 *   npx hardhat run scripts/verify-failed-recovery.ts                  # in-process hardhat
 *   npx hardhat run scripts/verify-failed-recovery.ts --network localhost
 */
import path from "path";
import hre, { ethers } from "hardhat";

const STATE_LABELS = ["Setup", "Finalizing", "Claiming", "Failed"] as const;
const DECLARED_TOTAL = 1000n;
const WRONG_ALLOCATION = 100n;

async function bootstrapFhevm() {
  if (hre.network.name === "hardhat") {
    const extenderPath = path.join(
      require.resolve("@fhevm/hardhat-plugin"),
      "..",
      "internal",
      "EnvironmentExtender.js",
    );
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { fhevmContext } = require(extenderPath);
    const fhevmEnv = fhevmContext.get();
    if (!fhevmEnv.isDeployed) {
      fhevmEnv.setRunningInHHTest();
      await fhevmEnv.deploy();
    }
  } else {
    await hre.fhevm.initializeCLIApi();
  }
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

function shortAddr(a: string) {
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

let assertionCount = 0;
function assertEq<T>(actual: T, expected: T, label: string) {
  assertionCount++;
  const ok = actual === expected;
  const marker = ok ? "✓" : "✗";
  console.log(`      ${marker} [${assertionCount}] ${label}: ${actual}`);
  if (!ok) {
    throw new Error(
      `Assertion failed — ${label}: expected ${expected}, got ${actual}`,
    );
  }
}

async function main() {
  await bootstrapFhevm();

  const signers = await ethers.getSigners();
  if (signers.length < 4) {
    throw new Error(`Need at least 4 signers, got ${signers.length}.`);
  }
  const [deployer, recipient1, recipient2, recipient3] = signers;

  console.log("════════════════════════════════════════════════════════════");
  console.log("  ZamaDrop · verify-failed-recovery (Layer 4 E2E verification)");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`network    : ${hre.network.name}`);
  console.log(`deployer   : ${deployer.address} (admin)`);
  console.log("");

  // ─── Phase A: Produce a Failed campaign (mirror trigger-failed.ts) ─────
  console.log("── Phase A: Produce State.Failed campaign ──────────────────");

  console.log("[A1] Deploy MockToken (ZDT)…");
  const MockToken = await ethers.getContractFactory("MockToken");
  const token = await MockToken.deploy(
    "ZamaDrop Test Token",
    "ZDT",
    10_000n,
    deployer.address,
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`     token at ${tokenAddress}`);

  console.log("[A2] Deploy ZamaDropCampaign with declaredTotal=1000…");
  const recipients = [recipient1.address, recipient2.address, recipient3.address];
  const listHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [recipients]),
  );
  const Campaign = await ethers.getContractFactory("ZamaDropCampaign");
  const campaign = await Campaign.deploy(
    deployer.address,
    recipient1.address,
    tokenAddress,
    DECLARED_TOTAL,
    recipients,
    listHash,
  );
  await campaign.waitForDeployment();
  const campaignAddress = await campaign.getAddress();
  console.log(`     campaign at ${campaignAddress}`);

  console.log("[A3] Fund 1000 ZDT to campaign…");
  await (await token.connect(deployer).transfer(campaignAddress, DECLARED_TOTAL)).wait();

  console.log("[A4] setAllocation × 3 with sum=300 ≠ declaredTotal=1000…");
  for (const recipient of recipients) {
    const enc = await encryptAmount(campaignAddress, deployer.address, WRONG_ALLOCATION);
    await (await campaign.connect(deployer).setAllocation(recipient, enc.handle, enc.proof)).wait();
    console.log(`     ✓ ${shortAddr(recipient)} ← ${WRONG_ALLOCATION}`);
  }

  console.log("[A5] finalize() → KMS publicDecrypt → callbackFinalize(false)…");
  await (await campaign.connect(deployer).finalize()).wait();
  const checkHandle = await campaign.finalizeCheckHandle();
  const decrypted = await hre.fhevm.publicDecrypt([checkHandle]);
  const sumCheck = decrypted.clearValues[checkHandle] as boolean;
  await (await campaign.connect(deployer).callbackFinalize(sumCheck, decrypted.decryptionProof)).wait();

  const stateAfterCb = Number(await campaign.state());
  console.log("[A6] State assertions:");
  assertEq(sumCheck, false, "KMS sumCheck (300 ≠ 1000)");
  assertEq(stateAfterCb, 3, `state = ${STATE_LABELS[stateAfterCb] ?? "?"} (3)`);

  const balanceBeforeCancel = await token.balanceOf(campaignAddress);
  const adminBalanceBeforeCancel = await token.balanceOf(deployer.address);
  assertEq(balanceBeforeCancel, DECLARED_TOTAL, "campaign balance before cancel");
  console.log("");

  // ─── Phase B: Negative test — non-admin caller reverts NotAdmin ─────────
  console.log("── Phase B: Negative test — non-admin reverts NotAdmin ─────");
  console.log("[B1] recipient2.cancelCampaign() — expected revert NotAdmin…");
  let nonAdminReverted = false;
  let nonAdminRevertReason = "";
  try {
    await campaign.connect(recipient2).cancelCampaign();
  } catch (err) {
    nonAdminReverted = true;
    nonAdminRevertReason = (err as Error).message;
  }
  assertEq(nonAdminReverted, true, "non-admin call reverted");
  const matchedNotAdmin = nonAdminRevertReason.includes("NotAdmin");
  assertEq(matchedNotAdmin, true, "revert reason includes 'NotAdmin'");
  console.log("");

  // ─── Phase C: Admin cancelCampaign — substitute for UI button ──────────
  console.log("── Phase C: admin.cancelCampaign() — UI button substitute ──");
  console.log("[C1] deployer.cancelCampaign()…");
  const cancelTx = await campaign.connect(deployer).cancelCampaign();
  const cancelReceipt = await cancelTx.wait();
  console.log(`     tx ${cancelTx.hash}`);

  console.log("[C2] Assert CampaignCancelled event emitted with returnedAmount=1000…");
  const cancelEvent = cancelReceipt?.logs
    .map((log) => {
      try {
        return campaign.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "CampaignCancelled");
  if (!cancelEvent) {
    throw new Error("CampaignCancelled event not found in cancel tx receipt");
  }
  const returnedAmount = cancelEvent.args[0] as bigint;
  assertEq(returnedAmount, DECLARED_TOTAL, "CampaignCancelled.returnedAmount");

  console.log("[C3] Assert balances after recovery…");
  const balanceAfterCancel = await token.balanceOf(campaignAddress);
  const adminBalanceAfterCancel = await token.balanceOf(deployer.address);
  assertEq(balanceAfterCancel, 0n, "campaign balance after cancel = 0");
  assertEq(
    adminBalanceAfterCancel - adminBalanceBeforeCancel,
    DECLARED_TOTAL,
    "admin balance delta = +1000",
  );

  console.log("[C4] Assert state STAYS Failed (cancelCampaign does not transition state)…");
  const stateAfterCancel = Number(await campaign.state());
  assertEq(stateAfterCancel, 3, `state still Failed (${stateAfterCancel})`);
  console.log("");

  // ─── Phase D: Idempotency ──────────────────────────────────────────────
  console.log("── Phase D: Idempotency — second cancelCampaign succeeds ───");
  console.log("[D1] deployer.cancelCampaign() (again) — expected success, returnedAmount=0…");
  const cancelTx2 = await campaign.connect(deployer).cancelCampaign();
  const cancelReceipt2 = await cancelTx2.wait();
  const cancelEvent2 = cancelReceipt2?.logs
    .map((log) => {
      try {
        return campaign.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "CampaignCancelled");
  if (!cancelEvent2) {
    throw new Error("CampaignCancelled event not found in second cancel tx");
  }
  const returnedAmount2 = cancelEvent2.args[0] as bigint;
  assertEq(returnedAmount2, 0n, "second cancel returnedAmount = 0 (idempotent)");
  const finalBalance = await token.balanceOf(campaignAddress);
  assertEq(finalBalance, 0n, "campaign balance still 0");
  console.log("");

  // ─── Summary ──────────────────────────────────────────────────────────
  console.log("============================================================");
  console.log("  ✅ LAYER 4 E2E VERIFICATION PASSED");
  console.log("============================================================");
  console.log(`Total assertions: ${assertionCount}`);
  console.log(`Campaign:         ${campaignAddress}`);
  console.log(`Token:            ${tokenAddress}`);
  console.log(`Admin:            ${deployer.address}`);
  console.log("");
  console.log("Verified invariants:");
  console.log("  • State.Failed reachable via callbackFinalize(false)");
  console.log("  • Non-admin cancelCampaign() reverts with NotAdmin");
  console.log("  • Admin cancelCampaign() transfers full escrow back to admin");
  console.log("  • CampaignCancelled(returnedAmount) emitted with correct value");
  console.log("  • State stays Failed after cancelCampaign (no transition)");
  console.log("  • Second cancelCampaign() is idempotent (returnedAmount=0)");
  console.log("");
  console.log("UI verification (manual, separate):");
  console.log("  • CancelCampaignForm renders correctly when stateNum===3 (verified Layer 3 mock)");
  console.log("  • parseContractRevert maps NotFailed/'gas limit too high' to human copy (Subagent #6)");
  console.log("  • Browser flow: trigger-failed.ts + npm run dev + MetaMask cancelCampaign click");
  console.log("============================================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
