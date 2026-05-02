/**
 * 端到端真实流程脚本：在 Sepolia 上跑 setAllocation → finalize → claim → executeTransfer
 *
 * 我们只有 1 个私钥（deployer），所以：
 * - recipient1 = deployer 自己（能 claim 拿到 ZDT）
 * - recipient2 = 一个随机地址（用于撑起 declaredTotal=1000 的总和约束，但永不 claim）
 *
 * 这足以演示 FHE 隐私 + 总量验证 + claim 流程的全部要点。
 */
import path from "path";
import hre, { ethers } from "hardhat";
import deployment from "../deployments/sepolia.json";

const TOKEN = deployment.contracts.MockToken.address;
const CAMPAIGN = deployment.contracts.ZamaDropCampaign.address;

// 第二个受益人地址（永不 claim，仅用于撑总和）
const FAKE_RECIPIENT = "0x000000000000000000000000000000000000dEaD";

const ALLOC_DEPLOYER = 600n;
const ALLOC_FAKE = 400n;

async function bootstrapFhevm() {
  if (hre.network.name === "hardhat") {
    const extenderPath = path.join(
      require.resolve("@fhevm/hardhat-plugin"),
      "..",
      "internal",
      "EnvironmentExtender.js",
    );
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

async function main() {
  await bootstrapFhevm();

  const [deployer] = await ethers.getSigners();
  console.log("=== ZamaDrop E2E (Sepolia) ===");
  console.log("Deployer / Recipient1:", deployer.address);
  console.log("Fake Recipient2:      ", FAKE_RECIPIENT);
  console.log("Token:                ", TOKEN);
  console.log("Campaign:             ", CAMPAIGN);
  console.log("");

  const campaign = await ethers.getContractAt("ZamaDropCampaign", CAMPAIGN);
  const token = await ethers.getContractAt("MockToken", TOKEN);

  // ─────────────────────────────────────────────
  // Step 1: 设置 deployer 自己的 allocation = 600
  // ─────────────────────────────────────────────
  const finalized0 = await campaign.finalized();
  const set0 = await campaign.allocationSet(deployer.address);
  console.log("[State] finalized=", finalized0, "allocationSet[deployer]=", set0);

  if (!set0) {
    console.log("\n[1/6] setAllocation(deployer, 600)...");
    const input1 = hre.fhevm.createEncryptedInput(CAMPAIGN, deployer.address);
    input1.add64(ALLOC_DEPLOYER);
    const enc1 = await input1.encrypt();
    const tx1 = await campaign.setAllocation(deployer.address, enc1.handles[0], enc1.inputProof);
    console.log("    tx:", tx1.hash);
    await tx1.wait();
    console.log("    ✓ confirmed");
  } else {
    console.log("[1/6] setAllocation(deployer): SKIP (already set)");
  }

  // ─────────────────────────────────────────────
  // Step 2: 设置 fake recipient 的 allocation = 400
  // ─────────────────────────────────────────────
  const set1 = await campaign.allocationSet(FAKE_RECIPIENT);
  if (!set1) {
    console.log("\n[2/6] setAllocation(fake, 400)...");
    const input2 = hre.fhevm.createEncryptedInput(CAMPAIGN, deployer.address);
    input2.add64(ALLOC_FAKE);
    const enc2 = await input2.encrypt();
    const tx2 = await campaign.setAllocation(FAKE_RECIPIENT, enc2.handles[0], enc2.inputProof);
    console.log("    tx:", tx2.hash);
    await tx2.wait();
    console.log("    ✓ confirmed");
  } else {
    console.log("[2/6] setAllocation(fake): SKIP (already set)");
  }

  // ─────────────────────────────────────────────
  // Step 3: finalize（FHE.eq 验证总量）
  // ─────────────────────────────────────────────
  if (!(await campaign.finalized())) {
    let checkHandle = await campaign.finalizeCheckHandle();
    if (checkHandle === ethers.ZeroHash) {
      console.log("\n[3/6] finalize()...");
      const tx3 = await campaign.finalize();
      console.log("    tx:", tx3.hash);
      await tx3.wait();
      checkHandle = await campaign.finalizeCheckHandle();
      console.log("    ✓ confirmed, finalizeCheckHandle:", checkHandle);
    } else {
      console.log("\n[3/6] finalize: SKIP (handle already exists)");
    }

    // 公开解密 ebool
    console.log("\n[4/6] publicDecryptEbool(checkHandle)... (KMS, 可能 30~60s)");
    const sumOk = await hre.fhevm.publicDecryptEbool(checkHandle);
    console.log("    decrypted:", sumOk);

    console.log("\n     callbackFinalize(", sumOk, ")...");
    const tx4 = await campaign.callbackFinalize(sumOk);
    console.log("    tx:", tx4.hash);
    await tx4.wait();
    console.log("    ✓ finalized=", await campaign.finalized());
  } else {
    console.log("[3-4/6] finalize: SKIP (already finalized)");
  }

  // ─────────────────────────────────────────────
  // Step 5: deployer 调 claim
  // ─────────────────────────────────────────────
  if (!(await campaign.claimed(deployer.address))) {
    console.log("\n[5/6] claim() from deployer...");
    const tx5 = await campaign.claim();
    console.log("    tx:", tx5.hash);
    await tx5.wait();
    console.log("    ✓ claimed=true, pendingClaimHandle=", await campaign.pendingClaimHandle(deployer.address));
  } else {
    console.log("[5/6] claim: SKIP (already claimed)");
  }

  // ─────────────────────────────────────────────
  // Step 6: 解密 pendingClaimHandle 并调 executeTransfer
  // ─────────────────────────────────────────────
  if (!(await campaign.transferred(deployer.address))) {
    const pendingHandle = await campaign.pendingClaimHandle(deployer.address);
    console.log("\n[6/6] publicDecryptEuint(pendingHandle)... (KMS, 可能 30~60s)");
    const { FhevmType } = await import("@fhevm/mock-utils");
    const decrypted = await hre.fhevm.publicDecryptEuint(FhevmType.euint64, pendingHandle);
    console.log("    decrypted amount:", decrypted.toString());

    if (decrypted !== ALLOC_DEPLOYER) {
      throw new Error(`Decrypted ${decrypted} != expected ${ALLOC_DEPLOYER}`);
    }

    const balBefore = await token.balanceOf(deployer.address);
    console.log("\n     executeTransfer(deployer,", decrypted.toString(), ")...");
    const tx6 = await campaign.executeTransfer(deployer.address, decrypted);
    console.log("    tx:", tx6.hash);
    await tx6.wait();
    const balAfter = await token.balanceOf(deployer.address);
    console.log("    ✓ ZDT balance:", balBefore.toString(), "→", balAfter.toString());
  } else {
    console.log("[6/6] executeTransfer: SKIP (already transferred)");
  }

  console.log("\n=== ✓ E2E Complete ===");
  console.log("Sepolia transactions saved on-chain — visit Etherscan to inspect:");
  console.log(`  Campaign: https://sepolia.etherscan.io/address/${CAMPAIGN}`);
  console.log(`  Deployer: https://sepolia.etherscan.io/address/${deployer.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
