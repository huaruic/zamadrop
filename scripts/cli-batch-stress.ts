/**
 * Local hardhat stress driver for the setAllocationsBatch path.
 *
 * Standalone test driver for the batch primitive shipped by PR #4
 * (bulk-allocation). Deploys a fresh MockToken + ZamaDropCampaign on the
 * hardhat in-memory node, generates N random recipients, runs
 * setAllocationsBatch in BATCH_SIZE-sized chunks, finalizes the campaign,
 * actively pulls KMS via `hre.fhevm.publicDecrypt` to settle the sum-check
 * callback, and prints a gas + timing report.
 *
 * Mirrors the chunking helper from frontend/src/pages/wizard/deploy.ts and
 * scripts/cli-setup.ts so any contract regression that affects the batch
 * path surfaces equally regardless of entry point.
 *
 * Run: RECIPIENTS_N=20 npx hardhat run scripts/cli-batch-stress.ts
 *
 * Env:
 *   RECIPIENTS_N   number of recipients to provision (default 20). Each
 *                  recipient gets exactly 1 ZDT so declaredTotal = N — keeps
 *                  the FHE sum-check arithmetic trivially verifiable.
 */
import path from "path";
import hre, { ethers } from "hardhat";

/** Mirrors frontend/src/pages/wizard/deploy.ts and scripts/cli-setup.ts.
 * HCU is the binding constraint at 16; do not bump without rerunning the
 * batch-size validation suite (test/ZamaDropCampaign.batch.test.ts). */
const BATCH_SIZE = 16;

const ZERO_HANDLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Bootstrap the FHEVM mock for `hardhat run` against the in-memory hardhat
 * network. `initializeCLIApi()` only supports localhost/sepolia; for the
 * `hardhat` network we reach into the plugin's EnvironmentExtender directly
 * to deploy the mock contracts. Mirrors the pattern in deploy/01_deploy.ts. */
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

/** Chunked setAllocationsBatch — mirrors the wizard helper. Returns the sum
 * of `gasUsed` across every batch tx so the caller can report total cost. */
async function setAllocationsBatched(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  campaign: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  campaignAddress: string,
  recipients: RecipientAlloc[],
): Promise<{ totalGas: bigint; batches: number }> {
  const totalBatches = Math.ceil(recipients.length / BATCH_SIZE);
  let totalGas = 0n;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const batchIdx = Math.floor(i / BATCH_SIZE) + 1;
    console.log(
      `      batch ${batchIdx}/${totalBatches} — encrypting ${chunk.length} amounts`,
    );
    const { handles, proof } = await encryptAmountsBatch(
      campaignAddress,
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
    const receipt = await tx.wait();
    totalGas += receipt.gasUsed as bigint;
    console.log(
      `      ✓ batch ${batchIdx}/${totalBatches} mined — gasUsed ${receipt.gasUsed}`,
    );
  }

  return { totalGas, batches: totalBatches };
}

async function main() {
  const t0 = Date.now();
  await bootstrapFhevm();

  const N = Number(process.env.RECIPIENTS_N ?? "20");
  if (!Number.isInteger(N) || N <= 0) {
    throw new Error(`RECIPIENTS_N must be a positive integer, got "${process.env.RECIPIENTS_N}"`);
  }

  const [admin] = await ethers.getSigners();
  const declaredTotal = BigInt(N); // each recipient gets 1 ZDT

  console.log("════════════════════════════════════════════════════════════");
  console.log("  ZamaDrop · CLI batch-path stress driver");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`network:        ${hre.network.name}`);
  console.log(`signer:         ${admin.address}`);
  console.log(`recipients (N): ${N}`);
  console.log(`declaredTotal:  ${declaredTotal} ZDT (1 per recipient)`);
  console.log(`BATCH_SIZE:     ${BATCH_SIZE}`);
  console.log("");

  // ─── 1. Generate N random recipients ──────────────────────────────
  console.log(`[1/5] generating ${N} random recipient addresses…`);
  const recipients: RecipientAlloc[] = [];
  for (let i = 0; i < N; i++) {
    recipients.push({
      address: ethers.Wallet.createRandom().address,
      amount: 1n,
    });
  }
  console.log(`      ✓ ${recipients.length} addresses generated`);

  // ─── 2. Deploy MockToken (1M ZDT supply, fits uint64) ─────────────
  // 1_000_000 keeps a deterministic supply regardless of N. The campaign
  // only needs declaredTotal in escrow; the rest stays with admin.
  console.log("[2/5] deploying MockToken (1M ZDT supply)…");
  const MockToken = await ethers.getContractFactory("MockToken");
  const token = await MockToken.deploy(
    "ZamaDrop Test Token",
    "ZDT",
    1_000_000n,
    admin.address,
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`      ✓ MockToken at ${tokenAddress}`);

  // ─── 3. Deploy ZamaDropCampaign ───────────────────────────────────
  console.log("[3/5] deploying ZamaDropCampaign…");
  const recipientAddrs = recipients.map((r) => r.address);
  const listHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [recipientAddrs]),
  );
  const Campaign = await ethers.getContractFactory("ZamaDropCampaign");
  const campaign = await Campaign.deploy(
    admin.address,
    admin.address, // auditor = admin
    tokenAddress,
    declaredTotal,
    recipientAddrs,
    listHash,
  );
  await campaign.waitForDeployment();
  const campaignAddress = await campaign.getAddress();
  console.log(`      ✓ ZamaDropCampaign at ${campaignAddress}`);

  // Fund campaign with declaredTotal
  const fundTx = await token.transfer(campaignAddress, declaredTotal);
  await fundTx.wait();
  console.log(`      ✓ funded campaign with ${declaredTotal} ZDT`);

  // ─── 4. setAllocationsBatch (chunked) ─────────────────────────────
  console.log(
    `[4/5] setAllocationsBatch — ${recipients.length} recipients in ⌈N/${BATCH_SIZE}⌉ batches`,
  );
  const { totalGas, batches } = await setAllocationsBatched(
    campaign,
    admin,
    campaignAddress,
    recipients,
  );
  console.log(
    `      ✓ ${batches} batches mined, total gas ${totalGas.toString()}`,
  );

  // ─── 5. finalize + active-pull callbackFinalize ───────────────────
  console.log("[5/5] finalize() + active-pull callbackFinalize…");
  const handleBefore = await campaign.finalizeCheckHandle();
  if (handleBefore === ZERO_HANDLE) {
    const txF = await campaign.connect(admin).finalize();
    await txF.wait();
    console.log(`      ✓ finalize tx ${txF.hash}`);
  } else {
    console.log(`      handle already emitted — skip submit`);
  }

  const checkHandle = await campaign.finalizeCheckHandle();
  console.log("      active-pull: hre.fhevm.publicDecrypt(finalizeCheckHandle)…");
  const decrypted = await hre.fhevm.publicDecrypt([checkHandle]);
  const sumCheck = decrypted.clearValues[checkHandle] as boolean;
  console.log(
    `      sumCheck = ${sumCheck} (${sumCheck ? "matches → Claiming" : "mismatch → Failed"})`,
  );
  const txCb = await campaign
    .connect(admin)
    .callbackFinalize(sumCheck, decrypted.decryptionProof);
  await txCb.wait();
  console.log(`      ✓ callbackFinalize tx ${txCb.hash}`);

  const stateAfter = Number(await campaign.state());
  const stateName =
    stateAfter === 0
      ? "Setup"
      : stateAfter === 1
      ? "Finalizing"
      : stateAfter === 2
      ? "Claiming"
      : stateAfter === 3
      ? "Failed"
      : `Unknown(${stateAfter})`;

  const wallSec = ((Date.now() - t0) / 1000).toFixed(1);

  // ─── Final report ─────────────────────────────────────────────────
  console.log("");
  console.log("════════════════════════════════════════════════════════════");
  console.log("  Report");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`  recipients:   ${N}`);
  console.log(`  batches:      ${batches}  (BATCH_SIZE=${BATCH_SIZE})`);
  console.log(`  total gas:    ${totalGas.toString()}  (sum of setAllocationsBatch tx gasUsed)`);
  console.log(`  state:        ${stateAfter} (${stateName})`);
  console.log(`  wall-clock:   ${wallSec}s`);
  console.log("════════════════════════════════════════════════════════════");

  if (stateAfter !== 2) {
    throw new Error(
      `Expected state=2 (Claiming) at end, got ${stateAfter} (${stateName})`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
