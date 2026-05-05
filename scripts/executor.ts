/**
 * ZamaDrop Executor — off-chain settlement daemon.
 *
 * Trust model: this process is NOT a privileged role. The contract enforces
 * correctness via `FHE.checkSignatures` against KMS threshold signatures.
 * Anyone can run this — multiple parallel executors are safe (the on-chain
 * `transferred[user]` / `finalized` checks de-dup).
 *
 * Two flows handled:
 *   1. FinalizeRequested(handle) → publicDecrypt(ebool) → callbackFinalize(bool, proof)
 *   2. ClaimRequested(user, handle) → publicDecrypt(euint64) → executeTransfer(user, amount, proof)
 *
 * Run:    npx hardhat run scripts/executor.ts --network sepolia
 * Or:     npx hardhat run scripts/executor.ts --network localfhevm
 *
 * See docs/security-notes.md for the threat model this implements.
 */
import path from "path";
import hre, { ethers } from "hardhat";
import deployment from "../deployments/sepolia.json";

const CAMPAIGN_ADDR = deployment.contracts.ZamaDropCampaign.address;
const ZERO_HANDLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const POLL_INTERVAL_MS = 8000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

type Campaign = Awaited<ReturnType<typeof ethers.getContractAt>>;

async function settlePendingFinalize(campaign: Campaign, signer: any) {
  const finalized: boolean = await campaign.finalized();
  if (finalized) return;

  const handle: string = await campaign.finalizeCheckHandle();
  if (handle === ZERO_HANDLE) return;

  console.log(`[finalize] pending · handle=${shortHandle(handle)}`);

  const decryption = await hre.fhevm.publicDecrypt([handle]);
  const result = decryption.clearValues[handle] as boolean;
  const proof = decryption.decryptionProof;
  console.log(`[finalize] decrypted result=${result} · submitting callback`);

  const tx = await campaign.connect(signer).callbackFinalize(result, proof);
  const receipt = await tx.wait();
  console.log(`[finalize] settled ✓ block=${receipt?.blockNumber} tx=${tx.hash}`);
}

async function settlePendingTransfers(campaign: Campaign, signer: any) {
  // Scan recent blocks for Claimed events. Sepolia public RPC caps getLogs
  // range at 50k blocks, so we chunk to be safe (49k window per call).
  // For production this should track lastBlockSeen; for hackathon demo a
  // recent window covers all live claims.
  const filter = campaign.filters.Claimed();
  const latest = await ethers.provider.getBlockNumber();
  const fromBlock = Math.max(0, latest - 49000);
  const events = await campaign.queryFilter(filter, fromBlock, "latest");

  for (const ev of events) {
    const recipient = (ev as any).args.recipient as string;

    // Idempotent guards — skip ones already settled by another executor.
    const transferred: boolean = await campaign.transferred(recipient);
    if (transferred) continue;
    const claimed: boolean = await campaign.claimed(recipient);
    if (!claimed) continue;

    const handle: string = await campaign.pendingClaimHandle(recipient);
    if (handle === ZERO_HANDLE) continue;

    console.log(
      `[transfer] pending · recipient=${shortAddr(recipient)} handle=${shortHandle(handle)}`,
    );

    const decryption = await hre.fhevm.publicDecrypt([handle]);
    const amount = decryption.clearValues[handle] as bigint;
    const proof = decryption.decryptionProof;
    console.log(
      `[transfer] decrypted amount=${amount} · submitting executeTransfer`,
    );

    const tx = await campaign
      .connect(signer)
      .executeTransfer(recipient, amount, proof);
    const receipt = await tx.wait();
    console.log(
      `[transfer] settled ✓ recipient=${shortAddr(recipient)} amount=${amount} block=${receipt?.blockNumber} tx=${tx.hash}`,
    );
  }
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortHandle(handle: string) {
  return `${handle.slice(0, 10)}…${handle.slice(-8)}`;
}

async function main() {
  await bootstrapFhevm();

  const [signer] = await ethers.getSigners();
  const campaign = await ethers.getContractAt(
    "ZamaDropCampaign",
    CAMPAIGN_ADDR,
  );

  console.log("=== ZamaDrop Executor ===");
  console.log(`network:  ${hre.network.name}`);
  console.log(`signer:   ${signer.address}`);
  console.log(`campaign: ${CAMPAIGN_ADDR}`);
  console.log(`poll:     ${POLL_INTERVAL_MS}ms`);
  console.log("");

  // Loop forever — Ctrl+C to stop.
  // Each iteration: settle pending finalize, then sweep pending transfers.
  // Idempotent against parallel executors via on-chain `transferred` / `finalized` flags.
  while (true) {
    try {
      await settlePendingFinalize(campaign, signer);
      await settlePendingTransfers(campaign, signer);
    } catch (err) {
      console.error("[error]", err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
