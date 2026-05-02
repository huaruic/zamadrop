import hre, { ethers } from "hardhat";
import deployment from "../deployments/sepolia.json";

const TOKEN = deployment.contracts.MockToken.address;
const CAMPAIGN = deployment.contracts.ZamaDropCampaign.address;
const DEPLOYER = "0x0000000000000000000000000000000000000000";
const FAKE = "0x000000000000000000000000000000000000dEaD";

async function main() {
  const token = await ethers.getContractAt("MockToken", TOKEN);
  const campaign = await ethers.getContractAt("ZamaDropCampaign", CAMPAIGN);

  console.log("=== Sepolia 链上状态验证 ===\n");

  console.log("[1] ZDT 代币余额（直接读 ERC20 balanceOf）：");
  const balDeployer = await token.balanceOf(DEPLOYER);
  const balCampaign = await token.balanceOf(CAMPAIGN);
  console.log("  Deployer 钱包:    ", balDeployer.toString(), "ZDT  ← 这是从 Campaign claim 来的");
  console.log("  Campaign escrow:  ", balCampaign.toString(), "ZDT  ← 1000 - 600 = 400 还在 escrow");

  console.log("\n[2] ZamaDropCampaign 合约状态：");
  console.log("  finalized:               ", await campaign.finalized());
  console.log("  claimed[deployer]:       ", await campaign.claimed(DEPLOYER));
  console.log("  transferred[deployer]:   ", await campaign.transferred(DEPLOYER));
  console.log("  allocationSet[deployer]: ", await campaign.allocationSet(DEPLOYER));
  console.log("  allocationSet[fake]:     ", await campaign.allocationSet(FAKE));
  console.log("  declaredTotal:           ", (await campaign.declaredTotal()).toString());

  console.log("\n[3] 事件历史（最近 5000 区块）：");
  const latest = await ethers.provider.getBlockNumber();
  const fromBlock = Math.max(0, latest - 5000);
  const allEvents = await campaign.queryFilter("*" as any, fromBlock, "latest");
  for (const ev of allEvents) {
    if ("eventName" in ev && ev.eventName) {
      console.log(`  block ${ev.blockNumber} | ${ev.eventName.padEnd(20)} | tx: ${ev.transactionHash.slice(0, 12)}...`);
    }
  }
}

main().catch(console.error);
