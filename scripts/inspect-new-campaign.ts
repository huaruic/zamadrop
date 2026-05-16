import { ethers } from "hardhat";

const STATE_LABELS = ["Setup", "Finalizing", "Claiming", "Failed"] as const;

async function main() {
  const CAMPAIGN = process.env.CAMPAIGN ?? process.argv[2];
  if (!CAMPAIGN || !/^0x[0-9a-fA-F]{40}$/.test(CAMPAIGN)) {
    throw new Error(
      "campaign address required: set CAMPAIGN=0x… or pass it as the first arg",
    );
  }

  const campaign = await ethers.getContractAt("ZamaDropCampaign", CAMPAIGN);

  const state = await campaign.state();
  const declaredTotal = await campaign.declaredTotal();
  const recipientCount = await campaign.recipientCount();
  const allocationCount = await campaign.allocationCount();
  const recipientListHash = await campaign.recipientListHash();
  const tokenAddr = await campaign.token();
  const admin = await campaign.admin();

  const token = await ethers.getContractAt("MockToken", tokenAddr);
  const balCampaign = await token.balanceOf(CAMPAIGN);

  console.log("=== Inspect Campaign", CAMPAIGN, "===");
  console.log("admin:               ", admin);
  console.log("token:               ", tokenAddr);
  console.log("state:               ", `${state} (${STATE_LABELS[Number(state)]})`);
  console.log("declaredTotal:       ", declaredTotal.toString());
  console.log("recipientCount:      ", recipientCount.toString());
  console.log("allocationCount:     ", allocationCount.toString());
  console.log("token balance:       ", balCampaign.toString());
  console.log("recipientListHash:   ", recipientListHash);

  console.log("\n--- finalize() preconditions ---");
  console.log("state == Setup        :", Number(state) === 0);
  console.log("alloc == recipient    :", allocationCount === recipientCount);
  console.log("balance >= declared   :", balCampaign >= declaredTotal);

  console.log("\n--- recent events (last 10000 blocks) ---");
  const latest = await ethers.provider.getBlockNumber();
  const fromBlock = Math.max(0, latest - 10000);
  const events = await campaign.queryFilter("*" as any, fromBlock, "latest");
  for (const ev of events) {
    if ("eventName" in ev && ev.eventName) {
      const args =
        "args" in ev && ev.args
          ? Object.entries(ev.args)
              .filter(([k]) => isNaN(Number(k)))
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")
          : "";
      console.log(
        `  block ${ev.blockNumber} | ${ev.eventName.padEnd(20)} | ${args} | tx ${ev.transactionHash.slice(0, 12)}…`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
