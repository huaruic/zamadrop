import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { SEPOLIA_RPC } from "./config";

const e2eSingleWallet = import.meta.env.VITE_E2E_SINGLE_WALLET === "true";

export const wagmiConfig = createConfig({
  chains: [sepolia],
  multiInjectedProviderDiscovery: !e2eSingleWallet,
  connectors: [
    e2eSingleWallet
      ? injected({ target: "metaMask", shimDisconnect: false })
      : injected(),
  ],
  transports: {
    [sepolia.id]: http(SEPOLIA_RPC),
  },
});
