import { useConnect } from "wagmi";

import { hasWalletProvider, openMetaMaskInstall } from "./wallet-connect";

export function useConnectWallet() {
  const { connect, connectors, error, isPending } = useConnect();
  const connector = connectors[0];

  const connectWallet = async () => {
    if (!connector) {
      openMetaMaskInstall();
      return;
    }
    if (!(await hasWalletProvider(connector))) {
      openMetaMaskInstall();
      return;
    }
    connect({ connector });
  };

  return { connectWallet, error, isPending };
}
