import { ethers } from "hardhat";
import deployment from "../deployments/sepolia.json";

const TOKEN = deployment.contracts.MockToken.address;

async function main() {
  const recipient =
    process.env.MINT_TO ?? "0x81f19692e5C59a7D7DB7D0689843C213C9BFA260";
  const amount = BigInt(process.env.MINT_AMOUNT ?? "2000");

  const [signer] = await ethers.getSigners();
  console.log("Signer (must be MockToken admin):", signer.address);
  console.log("Token:", TOKEN);
  console.log("Mint to:", recipient);
  console.log("Amount (raw, decimals=0):", amount.toString());

  const token = await ethers.getContractAt("MockToken", TOKEN);
  const adminOnContract = await token.admin();
  if (adminOnContract.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `signer ${signer.address} is not MockToken.admin (${adminOnContract})`,
    );
  }

  const before = await token.balanceOf(recipient);
  console.log("Recipient balance before:", before.toString());

  console.log("Sending mint tx…");
  const tx = await token.mint(recipient, amount);
  console.log("Tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Mined in block:", receipt?.blockNumber);

  const after = await token.balanceOf(recipient);
  console.log("Recipient balance after:", after.toString());
  console.log("Delta:", (after - before).toString());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
