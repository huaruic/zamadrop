import { useConnect } from "wagmi";

import { openMetaMaskInstall } from "./wallet-connect";

export function useConnectWallet() {
  const { connect, connectors, error, isPending } = useConnect();
  const connector = connectors[0];

  const connectWallet = () => {
    if (!connector) {
      openMetaMaskInstall();
      return;
    }
    connect({ connector });
  };

  return { connectWallet, error, isPending };
}
