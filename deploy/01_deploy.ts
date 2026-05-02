import path from "path";
import hre, { ethers } from "hardhat";

async function main() {
  // FHEVM mock runtime needs explicit bootstrap when running via `hardhat run`
  // against the in-process `hardhat` network. `hardhat test` and `hardhat node`
  // do this automatically; `initializeCLIApi()` only supports localhost/sepolia.
  if (hre.network.name === "hardhat") {
    // The plugin's internal context isn't exported in package.json#exports, so
    // resolve the compiled file by absolute path to bypass the exports map.
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

  const [deployer] = await ethers.getSigners();

  const declaredTotal = BigInt(process.env.DECLARED_TOTAL ?? "1000");
  const recipientCount = BigInt(process.env.RECIPIENT_COUNT ?? "2");
  const auditorAddress = process.env.AUDITOR_ADDRESS ?? deployer.address;

  console.log("=== ZamaDrop Deployment ===");
  console.log("Deployer (admin):", deployer.address);
  console.log("Auditor:         ", auditorAddress);
  console.log("Declared total:  ", declaredTotal.toString());
  console.log("Recipient count: ", recipientCount.toString());
  console.log("");

  // 1. Deploy MockToken (admin auto-receives initialSupply)
  const MockToken = await ethers.getContractFactory("MockToken");
  const token = await MockToken.deploy(
    "ZamaDrop Test Token",
    "ZDT",
    declaredTotal,
    deployer.address,
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("MockToken deployed at:        ", tokenAddress);

  // 2. Deploy ZamaDropCampaign with token address
  const Campaign = await ethers.getContractFactory("ZamaDropCampaign");
  const campaign = await Campaign.deploy(
    declaredTotal,
    recipientCount,
    auditorAddress,
    tokenAddress,
  );
  await campaign.waitForDeployment();
  const campaignAddress = await campaign.getAddress();
  console.log("ZamaDropCampaign deployed at: ", campaignAddress);

  // 3. Admin transfers declaredTotal tokens to campaign as escrow
  const transferTx = await token.transfer(campaignAddress, declaredTotal);
  await transferTx.wait();
  const escrowBalance = await token.balanceOf(campaignAddress);
  console.log("");
  console.log("Escrow funded:");
  console.log("  campaign balance:", escrowBalance.toString());
  console.log("  tx hash:         ", transferTx.hash);

  // 4. Frontend usage hint
  console.log("");
  console.log("=== Frontend env ===");
  console.log(`VITE_TOKEN_ADDRESS=${tokenAddress}`);
  console.log(`VITE_CAMPAIGN_ADDRESS=${campaignAddress}`);
  console.log(`VITE_ADMIN_ADDRESS=${deployer.address}`);
  console.log(`VITE_AUDITOR_ADDRESS=${auditorAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
