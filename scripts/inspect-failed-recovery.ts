/**
 * Read-only inspection of the local Failed campaign state — used to answer
 * "did my cancelCampaign click actually succeed?" without leaving the
 * terminal.
 */
import hre, { ethers } from "hardhat";

async function main() {
  const tokenAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const campaignAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
  const adminAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  const token = await ethers.getContractAt("MockToken", tokenAddress);
  const campaign = await ethers.getContractAt("ZamaDropCampaign", campaignAddress);

  const adminBal = await token.balanceOf(adminAddress);
  const campaignBal = await token.balanceOf(campaignAddress);
  const state = Number(await campaign.state());

  const STATE_LABELS = ["Setup", "Finalizing", "Claiming", "Failed"];

  console.log("════════════════════════════════════════════════════════════");
  console.log("  Live chain state on hardhat node (8545)");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`Admin    : ${adminAddress}`);
  console.log(`  ZDT balance: ${adminBal}`);
  console.log("");
  console.log(`Campaign : ${campaignAddress}`);
  console.log(`  ZDT balance: ${campaignBal}`);
  console.log(`  state:       ${state} (${STATE_LABELS[state] ?? "?"})`);
  console.log("");

  // CampaignCancelled events
  const filter = campaign.filters.CampaignCancelled();
  const events = await campaign.queryFilter(filter, 0, "latest");
  console.log(`CampaignCancelled events: ${events.length}`);
  for (let i = 0; i < events.length; i++) {
    const e = events[i] as ethers.EventLog;
    const args = e.args;
    console.log(
      `  #${i + 1}  block ${e.blockNumber}  tx ${e.transactionHash}  returnedAmount=${args[0]}`,
    );
  }
  console.log("");

  // Token Transfer events to admin (incoming)
  const transferFilter = token.filters.Transfer(undefined, adminAddress);
  const transfers = await token.queryFilter(transferFilter, 0, "latest");
  console.log(`Token Transfer → admin events: ${transfers.length}`);
  for (let i = 0; i < transfers.length; i++) {
    const e = transfers[i] as ethers.EventLog;
    const args = e.args;
    console.log(
      `  #${i + 1}  block ${e.blockNumber}  from ${args[0]}  amount=${args[2]}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
