/**
 * Recover a campaign stuck in Finalizing state by actively pulling the KMS
 * decryption result and submitting callbackFinalize ourselves — instead of
 * passively waiting for the Gateway to push.
 *
 * Hypothesis (2026-05-07): Sepolia Gateway sometimes misses the
 * FinalizeRequested event subscription. The encrypted ebool sumCheck
 * handle is on chain (`finalizeCheckHandle`) and was already
 * `makePubliclyDecryptable`'d. Anyone can ask the Gateway to decrypt it
 * via the relayer SDK and submit a valid callbackFinalize themselves.
 *
 * Usage:
 *   CAMPAIGN=0x5a20529d2c930CE73fdd299C10Db26E10D2FB80D \
 *   npx hardhat run scripts/recover-stuck-finalize.ts --network sepolia
 */
import path from "path";
import hre, { ethers } from "hardhat";

const STATE_LABELS = ["Setup", "Finalizing", "Claiming", "Failed"] as const;

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

async function main() {
  const target = process.env.CAMPAIGN;
  if (!target) throw new Error("Set CAMPAIGN env var to the stuck campaign address");

  await bootstrapFhevm();

  const [signer] = await ethers.getSigners();
  console.log("=== Active-pull KMS recovery ===");
  console.log("Network    :", hre.network.name);
  console.log("Signer     :", signer.address);
  console.log("Campaign   :", target);
  console.log("");

  const campaign = await ethers.getContractAt("ZamaDropCampaign", target);

  const stateBefore = Number(await campaign.state());
  console.log(`State before : ${STATE_LABELS[stateBefore] ?? stateBefore}`);
  if (stateBefore !== 1) {
    console.log("Not in Finalizing state — nothing to recover.");
    if (stateBefore === 2) console.log("(Already Claiming — KMS arrived on its own.)");
    if (stateBefore === 3) console.log("(Already Failed — KMS reported sum mismatch.)");
    return;
  }

  const handle = await campaign.finalizeCheckHandle();
  console.log("Sum-check handle :", handle);
  console.log("");

  console.log("[1/3] Asking relayer SDK to publicDecrypt the handle...");
  const t0 = Date.now();
  const result = await hre.fhevm.publicDecrypt([handle]);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`      Returned in ${elapsed}s`);
  const decrypted = result.clearValues[handle] as boolean;
  console.log(`      result            : ${decrypted}  (${decrypted ? "sum matches → will move to Claiming" : "sum mismatch → will move to Failed"})`);
  console.log(`      decryptionProof   : ${result.decryptionProof.slice(0, 18)}... (${(result.decryptionProof.length - 2) / 2} bytes)`);
  console.log("");

  console.log("[2/3] Submitting callbackFinalize ourselves...");
  const tx = await campaign.connect(signer).callbackFinalize(decrypted, result.decryptionProof);
  console.log("      tx :", tx.hash);
  console.log("      https://sepolia.etherscan.io/tx/" + tx.hash);
  const receipt = await tx.wait();
  console.log(`      status : ${receipt?.status === 1 ? "✅ Success" : "❌ Failed"}`);
  console.log("");

  console.log("[3/3] Verifying new state...");
  const stateAfter = Number(await campaign.state());
  console.log(`State after  : ${STATE_LABELS[stateAfter] ?? stateAfter}`);
  if (stateAfter === 2) {
    console.log("");
    console.log("🎉 Campaign recovered. Recipients can now claim.");
    console.log("   /c/" + target + "?role=recipient");
  } else if (stateAfter === 3) {
    console.log("");
    console.log("⚠ KMS reported sum mismatch. Admin can call cancelCampaign() to recover funds.");
  } else {
    console.log("");
    console.log("Unexpected state after callback — investigate.");
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message ?? e);
  process.exit(1);
});
