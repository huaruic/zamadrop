import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 800 },
      evmVersion: "cancun",
      metadata: { bytecodeHash: "none" },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    // Zama testnet — 部署时填入
    // zamaTestnet: {
    //   url: process.env.ZAMA_TESTNET_URL || "",
    //   accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    // },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
  },
};

export default config;
