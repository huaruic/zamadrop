import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("address:", signer.address);
  console.log("balance:", ethers.formatEther(balance), "ETH");
}

main().catch(console.error);
