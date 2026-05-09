/**
 * Deployment-derived constants. Contract addresses live in
 * `deployments/sepolia.json`; admin / auditor addresses are read live
 * from the campaign contract in `useRoleInfo`, never hard-coded.
 */
export const SEPOLIA_CHAIN_ID = 11155111;

export const CONTRACTS = {
  token: "0x775e867541D348F022B3431209710B5BC02Ad29C" as const,
  campaign: "0xDAe72F548BFc37649c7Da24Cd0a2c90a73E6c5c1" as const,
};

/** Offline fallback for the campaign directory. The Home page now sources its
 * listing from the backend (`GET /api/campaigns`); this constant is only used
 * when the backend is unreachable, alongside any addresses persisted in
 * `localStorage["zd:knownCampaigns"]`.
 * `VITE_CAMPAIGN_ADDRESS` overrides the hardcoded list when set — useful for
 * fresh-state E2E or when redeploying the contract during a hackathon push.
 * If unset, falls back to `CONTRACTS.campaign`. */
const envCampaign = import.meta.env.VITE_CAMPAIGN_ADDRESS as
  | `0x${string}`
  | undefined;

export const FALLBACK_CAMPAIGNS: readonly `0x${string}`[] = envCampaign
  ? [envCampaign]
  : [CONTRACTS.campaign];

export const ETHERSCAN_BASE = "https://sepolia.etherscan.io";
export const SEPOLIA_RPC = "https://ethereum-sepolia.publicnode.com";
