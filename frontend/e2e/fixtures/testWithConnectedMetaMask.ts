import { testWithSynpress } from "@synthetixio/synpress";
import { MetaMask, metaMaskFixtures } from "@synthetixio/synpress/playwright";

import connectedSetup from "../wallet-setup-connected/connected.setup";

export const test = testWithSynpress(metaMaskFixtures(connectedSetup)).extend<{
  metamask: MetaMask;
}>({
  metamask: async ({ context, metamaskPage, extensionId }, use) => {
    const metamask = new MetaMask(
      context,
      metamaskPage,
      connectedSetup.walletPassword,
      extensionId,
    );

    await use(metamask);
  },
});

export const { expect } = test;
