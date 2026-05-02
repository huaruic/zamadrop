/**
 * 部署配置：从 deployments/sepolia.json 同步而来
 * 修改部署后地址要同时更新这里
 */
export const SEPOLIA_CHAIN_ID = 11155111;

export const CONTRACTS = {
  token: "0xE8d42a29c5f796A5E45f4806BB28205EC387A68C" as const,
  campaign: "0x30Af9a636B0284338B5D6CB1DE5DaE3407B6Ed93" as const,
};

export const ADMIN_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const AUDITOR_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const ETHERSCAN_BASE = "https://sepolia.etherscan.io";
export const SEPOLIA_RPC = "https://ethereum-sepolia.publicnode.com";
