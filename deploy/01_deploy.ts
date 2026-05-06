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

  // 处理空字符串 fallback：?? 只对 null/undefined 生效，空字符串需要单独判断
  const nonEmpty = (v?: string) => (v && v.trim() !== "" ? v : undefined);

  const declaredTotal = BigInt(nonEmpty(process.env.DECLARED_TOTAL) ?? "1000");
  const auditorAddress = nonEmpty(process.env.AUDITOR_ADDRESS) ?? deployer.address;
  const existingToken = nonEmpty(process.env.EXISTING_TOKEN_ADDRESS);

  // V7 constructor takes the recipient list directly (hash committed on-chain,
  // list itself stays off-chain). RECIPIENTS is a comma-separated address list;
  // for smoke runs we fall back to a single-recipient list of [deployer].
  const recipientsRaw = nonEmpty(process.env.RECIPIENTS);
  const recipients = recipientsRaw
    ? recipientsRaw.split(",").map((s) => ethers.getAddress(s.trim()))
    : [deployer.address];
  const recipientCount = recipients.length;
  const listHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [recipients]),
  );

  console.log("=== ZamaDrop Deployment ===");
  console.log("Deployer:        ", deployer.address);
  console.log("Admin:           ", deployer.address, "(deployer)");
  console.log("Auditor:         ", auditorAddress);
  console.log("Declared total:  ", declaredTotal.toString());
  console.log("Recipient count: ", recipientCount);
  console.log("Recipient list hash:", listHash);
  console.log("");

  // 1. Deploy MockToken（如果环境变量提供了已存在的地址，复用以节省 gas）
  let tokenAddress: string;
  let token: any;
  if (existingToken) {
    tokenAddress = existingToken;
    token = await ethers.getContractAt("MockToken", tokenAddress);
    console.log("MockToken (reused):           ", tokenAddress);
  } else {
    const MockToken = await ethers.getContractFactory("MockToken");
    token = await MockToken.deploy(
      "ZamaDrop Test Token",
      "ZDT",
      declaredTotal,
      deployer.address,
    );
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
    console.log("MockToken deployed at:        ", tokenAddress);
  }

  // 2. Deploy ZamaDropCampaign with V7 constructor signature
  const Campaign = await ethers.getContractFactory("ZamaDropCampaign");
  const campaign = await Campaign.deploy(
    deployer.address, // admin_
    auditorAddress, // auditor_
    tokenAddress, // token_
    declaredTotal, // declaredTotal_
    recipients, // address[]
    listHash, // bytes32
  );
  await campaign.waitForDeployment();
  const campaignAddress = await campaign.getAddress();
  console.log("ZamaDropCampaign deployed at: ", campaignAddress);
  console.log("  recipientListHash:          ", await campaign.recipientListHash());

  // 3. Admin transfers declaredTotal tokens to campaign as escrow
  const adminBalance = await token.balanceOf(deployer.address);
  if (adminBalance < declaredTotal) {
    throw new Error(
      `Admin token balance (${adminBalance}) < declaredTotal (${declaredTotal}). ` +
        `If reusing an existing token, mint more or use a fresh deployment.`,
    );
  }
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
