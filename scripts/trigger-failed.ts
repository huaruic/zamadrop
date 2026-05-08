/**
 * One-shot driver that produces a `State.Failed` campaign on the local
 * hardhat / localhost network for end-to-end frontend verification.
 *
 * Strategy: deploy ZDT + ZamaDropCampaign with declaredTotal = 1000, set three
 * recipient allocations of 100 each (sum = 300, intentionally wrong), fund the
 * escrow with the full 1000 so finalize() passes its `NotFunded` guard, then
 * actively pull KMS via `hre.fhevm.publicDecrypt` and self-submit
 * callbackFinalize(false, proof). The contract transitions to
 * `State.Failed (3)`.
 *
 * Run:
 *   npx hardhat run scripts/trigger-failed.ts                  # in-process hardhat
 *   npx hardhat run scripts/trigger-failed.ts --network localhost
 */
import path from "path";
import hre, { ethers } from "hardhat";

const STATE_LABELS = ["Setup", "Finalizing", "Claiming", "Failed"] as const;
const DECLARED_TOTAL = 1000n;
const WRONG_ALLOCATION = 100n; // 3 × 100 = 300, not 1000

async function bootstrapFhevm() {
  // Mirror the recover-stuck-finalize.ts pattern. `initializeCLIApi()` only
  // works for localhost / sepolia; the in-process `hardhat` network needs the
  // mock environment booted via the plugin's internal context.
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

async function main() {
  await bootstrapFhevm();

  const signers = await ethers.getSigners();
  if (signers.length < 4) {
    throw new Error(
      `Need at least 4 signers, got ${signers.length}. Use the default hardhat network or localhost with the default account set.`,
    );
  }
  const [deployer, recipient1, recipient2, recipient3] = signers;

  console.log("════════════════════════════════════════════════════════════");
  console.log("  ZamaDrop · trigger-failed — produce a State.Failed campaign");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`network    : ${hre.network.name}`);
  console.log(`deployer   : ${deployer.address} (admin)`);
  console.log(`auditor    : ${recipient1.address} (= recipient1)`);
  console.log(`recipient2 : ${recipient2.address}`);
  console.log(`recipient3 : ${recipient3.address}`);
  console.log("");

  // ─── 1. Deploy ZDT ─────────────────────────────────────────────────
  console.log("[1/7] Deploying MockToken (ZDT) with 10000 initial supply…");
  const MockToken = await ethers.getContractFactory("MockToken");
  const token = await MockToken.deploy(
    "ZamaDrop Test Token",
    "ZDT",
    10_000n,
    deployer.address,
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`      token at ${tokenAddress}`);

  // ─── 2. Deploy campaign ────────────────────────────────────────────
  const recipients = [recipient1.address, recipient2.address, recipient3.address];
  const listHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [recipients]),
  );

  console.log("[2/7] Deploying ZamaDropCampaign…");
  console.log(`      declaredTotal = ${DECLARED_TOTAL}`);
  console.log(`      recipients    = [${recipients.map(shortAddr).join(", ")}]`);
  console.log(`      listHash      = ${listHash}`);
  const Campaign = await ethers.getContractFactory("ZamaDropCampaign");
  const campaign = await Campaign.deploy(
    deployer.address,
    recipient1.address, // auditor (= recipient1, any non-deployer EOA works)
    tokenAddress,
    DECLARED_TOTAL,
    recipients,
    listHash,
  );
  await campaign.waitForDeployment();
  const campaignAddress = await campaign.getAddress();
  console.log(`      campaign at ${campaignAddress}`);

  // ─── 3. Fund escrow with full declaredTotal ────────────────────────
  console.log("[3/7] Funding campaign with declaredTotal (1000) so finalize() clears NotFunded…");
  const fundTx = await token.connect(deployer).transfer(campaignAddress, DECLARED_TOTAL);
  await fundTx.wait();
  const balance = await token.balanceOf(campaignAddress);
  console.log(`      balance(campaign) = ${balance}`);

  // ─── 4. Set three intentionally-wrong allocations (100 + 100 + 100 = 300) ─
  console.log("[4/7] setAllocation × 3 with wrong amounts (100 each → sum 300 ≠ 1000)…");
  for (const recipient of recipients) {
    try {
      const enc = await encryptAmount(campaignAddress, deployer.address, WRONG_ALLOCATION);
      const tx = await campaign
        .connect(deployer)
        .setAllocation(recipient, enc.handle, enc.proof);
      await tx.wait();
      console.log(`      ✓ ${shortAddr(recipient)} ← ${WRONG_ALLOCATION}  (tx ${tx.hash})`);
    } catch (err) {
      const state = await campaign.state().catch(() => "?");
      console.error(
        `      ✗ setAllocation failed for ${recipient} (campaign ${campaignAddress}, state ${state}):`,
        err,
      );
      throw err;
    }
  }

  // ─── 5. finalize() — submits the FHE.eq handle ─────────────────────
  console.log("[5/7] finalize() — submits FHE.eq(runningTotal, declaredTotal) handle…");
  try {
    const fTx = await campaign.connect(deployer).finalize();
    await fTx.wait();
    console.log(`      ✓ tx ${fTx.hash}`);
  } catch (err) {
    const state = await campaign.state().catch(() => "?");
    console.error(
      `      ✗ finalize() reverted (campaign ${campaignAddress}, state ${state}):`,
      err,
    );
    throw err;
  }

  const stateAfterFinalize = Number(await campaign.state());
  console.log(`      state = ${STATE_LABELS[stateAfterFinalize] ?? stateAfterFinalize}`);
  if (stateAfterFinalize !== 1) {
    throw new Error(
      `Expected state Finalizing(1) after finalize(), got ${stateAfterFinalize}. campaign=${campaignAddress}`,
    );
  }

  // ─── 6. Active-pull KMS publicDecrypt + callbackFinalize(false) ────
  console.log("[6/7] Active-pull KMS: hre.fhevm.publicDecrypt(finalizeCheckHandle)…");
  let cbState: number;
  try {
    const checkHandle = await campaign.finalizeCheckHandle();
    console.log(`      handle  = ${checkHandle}`);
    const decrypted = await hre.fhevm.publicDecrypt([checkHandle]);
    const sumCheck = decrypted.clearValues[checkHandle] as boolean;
    console.log(`      sumCheck = ${sumCheck}  (expected false: 300 ≠ 1000)`);

    if (sumCheck !== false) {
      throw new Error(
        `KMS returned sumCheck=${sumCheck}, expected false. campaign=${campaignAddress}`,
      );
    }

    const cbTx = await campaign
      .connect(deployer)
      .callbackFinalize(sumCheck, decrypted.decryptionProof);
    await cbTx.wait();
    console.log(`      ✓ callbackFinalize tx ${cbTx.hash}`);
    cbState = Number(await campaign.state());
  } catch (err) {
    const state = await campaign.state().catch(() => "?");
    console.error(
      `      ✗ active-pull / callbackFinalize failed (campaign ${campaignAddress}, state ${state}):`,
      err,
    );
    throw err;
  }

  // ─── 7. Verify state == Failed (3) ─────────────────────────────────
  console.log("[7/7] Verifying state == Failed (3)…");
  if (cbState !== 3) {
    throw new Error(
      `Expected State.Failed (3), got ${cbState} (${STATE_LABELS[cbState] ?? "?"}). campaign=${campaignAddress}`,
    );
  }
  console.log(`      ✓ state = ${STATE_LABELS[cbState]} (${cbState})`);
  console.log("");

  const finalBalance = await token.balanceOf(campaignAddress);

  // ─── Summary banner ────────────────────────────────────────────────
  console.log("============================================================");
  console.log("FAILED CAMPAIGN READY FOR FRONTEND VERIFICATION");
  console.log("============================================================");
  console.log(`Campaign address: ${campaignAddress}`);
  console.log(`Token address:    ${tokenAddress}`);
  console.log(`Admin:            ${deployer.address} (deployer)`);
  console.log(`Auditor:          ${recipient1.address} (recipient1)`);
  console.log(`Declared total:   ${DECLARED_TOTAL} ZDT`);
  console.log(`Allocations sum:  ${WRONG_ALLOCATION * 3n} ZDT (intentionally wrong)`);
  console.log(`State:            ${cbState} (Failed)`);
  console.log(`Balance in contract: ${finalBalance} ZDT (待 admin 调 cancelCampaign 取回)`);
  console.log("");
  console.log("Frontend connection:");
  console.log("  1. cd frontend && VITE_RPC_URL=http://127.0.0.1:8545 npm run dev");
  console.log("  2. 切 wallet 到 hardhat (chainId 31337) 或者临时改 wagmi.ts 加 hardhat chain");
  console.log(`  3. 访问 /c/${campaignAddress}?role=admin / ?role=recipient / ?role=auditor`);
  console.log("  4. admin 页应见 CancelCampaignForm,点击执行 cancelCampaign");
  console.log("  5. 退款后 balance==0,recipient 页文案应从 \">0 admin 没退\" 切换到 \"已退还\"");
  console.log("============================================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
