/**
 * Deployment-derived constants. Contract addresses live in
 * `deployments/sepolia.json`; admin / auditor addresses are read live
 * from the campaign contract in `useRoleInfo`, never hard-coded.
 */
export const SEPOLIA_CHAIN_ID = 11155111;

export const CONTRACTS = {
  token: "0xE8d42a29c5f796A5E45f4806BB28205EC387A68C" as const,
  campaign: "0x30Af9a636B0284338B5D6CB1DE5DaE3407B6Ed93" as const,
};

export const ETHERSCAN_BASE = "https://sepolia.etherscan.io";
export const SEPOLIA_RPC = "https://ethereum-sepolia.publicnode.com";
