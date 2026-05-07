/**
 * CLI E2E driver for ZamaDrop. Deploys a fresh MockToken + ZamaDropCampaign
 * (V7 constructor) and drives the admin → recipient → auditor lifecycle.
 *
 * On Sepolia / localfhevm the off-chain `scripts/executor.ts` settles the
 * KMS publicDecrypt round-trips for finalize() and claim(); on local hardhat
 * without an executor the script will time out at the executor-wait step
 * after MAX_WAIT_MS — that's expected and the deploy artifacts are still
 * printed up-front.
 *
 * Env:
 *   RECIPIENTS=0xAAA,0xBBB         (required, comma-separated)
 *   DECLARED_TOTAL=1000            (default: 1000)
 *   AUDITOR_ADDRESS=0x...          (default: deployer)
 *
 * Run: npx hardhat run scripts/cli-setup.ts --network sepolia
 *      npx hardhat run scripts/cli-setup.ts --network localhost
 */
import path from "path";
import hre, { ethers } from "hardhat";
import { FhevmType } from "@fhevm/mock-utils";

const ZERO_HANDLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const POLL_MS = 5000;
const MAX_WAIT_MS = 180_000; // 3min — generous for Sepolia + KMS

function shortAddr(a: string) {
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

// Trim + treat empty string as undefined; mirrors deploy/01_deploy.ts so the
// two scripts agree on env-var semantics.
function nonEmpty(v?: string) {
  return v && v.trim() !== "" ? v : undefined;
}

async function bootstrapFhevm() {
  // `initializeCLIApi()` only supports localhost / sepolia. For the
  // in-process `hardhat` network we have to poke the plugin's internal
  // bootstrap by hand (same trick deploy/01_deploy.ts uses).
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

async function waitFor<T>(
  label: string,
  read: () => Promise<T>,
  predicate: (v: T) => boolean,
): Promise<T> {
  const start = Date.now();
  while (true) {
    const v = await read();
    if (predicate(v)) return v;
    if (Date.now() - start > MAX_WAIT_MS) {
      throw new Error(`Timed out waiting for: ${label}`);
    }
    process.stdout.write(`  …waiting for ${label} (${Math.round((Date.now() - start) / 1000)}s)\r`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// Even split of declaredTotal across recipients; remainder goes to recipient[0]
// so the sum-check on-chain still equals declaredTotal exactly.
function buildAmounts(declaredTotal: bigint, count: number): bigint[] {
  if (count === 0) throw new Error("no recipients");
  const base = declaredTotal / BigInt(count);
  const remainder = declaredTotal - base * BigInt(count);
  const amounts: bigint[] = new Array(count).fill(base);
  amounts[0] = amounts[0] + remainder;
  return amounts;
}

async function main() {
  await bootstrapFhevm();

  const [admin] = await ethers.getSigners();

  // ─── parse env (consistent with deploy/01_deploy.ts) ─────────────
  const declaredTotal = BigInt(nonEmpty(process.env.DECLARED_TOTAL) ?? "1000");
  const auditorAddress = nonEmpty(process.env.AUDITOR_ADDRESS) ?? admin.address;
  const recipientsRaw = nonEmpty(process.env.RECIPIENTS);
  if (!recipientsRaw) {
    throw new Error(
      "RECIPIENTS env var is required (comma-separated address list, e.g. RECIPIENTS=0xAAA,0xBBB)",
    );
  }
  const recipients = recipientsRaw
    .split(",")
    .map((s) => ethers.getAddress(s.trim()));
  const recipientCount = recipients.length;
  const listHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [recipients]),
  );

  const amounts = buildAmounts(declaredTotal, recipientCount);

  console.log("════════════════════════════════════════════════════════════");
  console.log("  ZamaDrop · CLI E2E driver (V7)");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`network:        ${hre.network.name}`);
  console.log(`signer (admin): ${admin.address}`);
  console.log(`auditor:        ${auditorAddress}`);
  console.log(`declaredTotal:  ${declaredTotal}`);
  console.log(`recipientCount: ${recipientCount}`);
  console.log(`recipientListHash: ${listHash}`);
  console.log("");

  // ─── 0a. deploy MockToken ─────────────────────────────────────────
  console.log("[deploy] MockToken…");
  const MockToken = await ethers.getContractFactory("MockToken");
  const token = await MockToken.deploy(
    "ZamaDrop Test Token",
    "ZDT",
    declaredTotal,
    admin.address,
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`         token: ${tokenAddress}`);

  // ─── 0b. deploy ZamaDropCampaign (V7 constructor) ─────────────────
  console.log("[deploy] ZamaDropCampaign…");
  const Campaign = await ethers.getContractFactory("ZamaDropCampaign");
  const campaign = await Campaign.deploy(
    admin.address,
    auditorAddress,
    tokenAddress,
    declaredTotal,
    recipients,
    listHash,
  );
  await campaign.waitForDeployment();
  const campaignAddress = await campaign.getAddress();
  console.log(`         campaign: ${campaignAddress}`);
  console.log(`         recipientListHash (on-chain): ${await campaign.recipientListHash()}`);
  console.log(`         declaredTotal (on-chain):     ${await campaign.declaredTotal()}`);
  console.log(`         recipientCount (on-chain):    ${await campaign.recipientCount()}`);

  // ─── 0c. fund escrow ──────────────────────────────────────────────
  const transferTx = await token.transfer(campaignAddress, declaredTotal);
  await transferTx.wait();
  console.log(`[escrow] funded campaign with ${declaredTotal} ZDT (tx ${transferTx.hash})`);
  console.log("");

  // ─── 1. setAllocation × N ──────────────────────────────────────────
  for (let i = 0; i < recipientCount; i += 1) {
    const recipient = recipients[i];
    const amount = amounts[i];
    const already = await campaign.allocationSet(recipient);
    if (already) {
      console.log(`[alloc ${i + 1}/${recipientCount}] ${shortAddr(recipient)} already set — skip`);
      continue;
    }
    console.log(`[alloc ${i + 1}/${recipientCount}] setAllocation(${shortAddr(recipient)}, ${amount})…`);
    const enc = await encryptAmount(campaignAddress, admin.address, amount);
    const tx = await campaign.connect(admin).setAllocation(recipient, enc.handle, enc.proof);
    await tx.wait();
    console.log(`           ✓ tx ${tx.hash}`);
  }

  // ─── 2. finalize() ────────────────────────────────────────────────
  console.log(`[finalize] submitting FHE.eq(runningTotal, declared) handle…`);
  const handleBefore = await campaign.finalizeCheckHandle();
  if (handleBefore === ZERO_HANDLE) {
    const txF = await campaign.connect(admin).finalize();
    await txF.wait();
    console.log(`           ✓ tx ${txF.hash}`);
  } else {
    console.log(`           handle already emitted — skip submit`);
  }

  // ─── 3. wait for executor to callbackFinalize ─────────────────────
  console.log("[finalize] waiting for executor to settle finalize via KMS publicDecrypt…");
  console.log("           (requires `npm run executor:local` running in another terminal)");
  await waitFor("finalized=true", () => campaign.finalized(), (v) => v === true);
  console.log("\n           ✓ executor settled — campaign now in Claiming phase");
  console.log("");

  // ─── 4. recipient userDecrypt of own allocation (if admin == recipients[0]) ─
  const adminIsRecipient0 = recipients[0].toLowerCase() === admin.address.toLowerCase();
  if (!adminIsRecipient0) {
    console.log(
      "─── recipient flow skipped: admin signer is not recipients[0]; userDecrypt requires the recipient's own key ───",
    );
    console.log("");
  } else {
    console.log("─── recipient flow (admin wallet acts as recipients[0]) ───");
    console.log("[recipient] requestMyAllocation()…");
    const myHandle = await campaign.connect(admin).requestMyAllocation();
    console.log(`             handle = ${myHandle}`);
    console.log("[recipient] userDecrypt(euint64) — proves only this wallet can read…");
    const myAmount = await hre.fhevm.userDecryptEuint(
      FhevmType.euint64,
      myHandle,
      campaignAddress,
      admin,
    );
    console.log(`             decrypted: ${myAmount} ZDT`);
    console.log("");

    // ─── 5. claim ──────────────────────────────────────────────────
    const alreadyClaimed = await campaign.claimed(admin.address);
    if (alreadyClaimed) {
      console.log("[claim] already claimed — skipping");
    } else {
      console.log("[claim] submitting claim()…");
      const txC = await campaign.connect(admin).claim();
      await txC.wait();
      console.log(`        ✓ tx ${txC.hash}`);
    }

    // ─── 6. wait for executor to executeTransfer ─────────────────
    console.log("[claim] waiting for executor to publicDecrypt + executeTransfer…");
    await waitFor(
      "transferred=true",
      () => campaign.transferred(admin.address),
      (v) => v === true,
    );
    console.log("\n        ✓ executor settled transfer");

    const balance = await token.balanceOf(admin.address);
    console.log(`[claim] ERC20 balance: ${balance} ZDT  ← real tokens in your wallet`);
    console.log("");
  }

  // ─── 7. auditor view ───────────────────────────────────────────────
  console.log("─── auditor flow ───");
  console.log("[auditor] requestClaimedTotalForAuditor() + userDecrypt…");
  const aggHandle = await campaign.connect(admin).requestClaimedTotalForAuditor();
  const claimedTotal = await hre.fhevm.userDecryptEuint(
    FhevmType.euint64,
    aggHandle,
    campaignAddress,
    admin,
  );
  const declared = await campaign.declaredTotal();
  const pct = declared > 0n
    ? (Number((claimedTotal * 10000n) / declared) / 100).toFixed(1)
    : "0.0";
  console.log(`          claimed_total = ${claimedTotal} ZDT  (${pct}% of declared)`);
  console.log("          ↑ aggregate only — auditor cannot decrypt any individual allocation");
  console.log("");

  // ─── 8. final summary ──────────────────────────────────────────────
  console.log("════════════════════════════════════════════════════════════");
  console.log("  E2E flow complete ✓");
  console.log("");
  console.log(`  campaign:          ${campaignAddress}`);
  console.log(`  recipientListHash: ${listHash}`);
  console.log(`  declaredTotal:     ${declaredTotal}`);
  console.log(`  recipientCount:    ${recipientCount}`);
  console.log("");
  console.log("  Lifecycle traversed:");
  console.log("    Setup → Finalizing → Claiming → Done");
  console.log("");
  console.log("  Off-chain executor handled:");
  console.log("    finalizeCheckHandle → publicDecrypt → callbackFinalize");
  console.log("    pendingClaimHandle  → publicDecrypt → executeTransfer");
  console.log("");
  console.log("  Trust root: Zama threshold KMS signatures, NOT executor identity.");
  console.log("════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
