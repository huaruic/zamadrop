import "../env";

import { defineWalletSetup } from "@synthetixio/synpress";
import { MetaMask, getExtensionId } from "@synthetixio/synpress/playwright";
import {
  completeOnboardingIfPresent,
  disableMetaMaskSidePanel,
} from "./completeOnboarding";

const walletPassword = process.env.E2E_WALLET_PASSWORD;
const seedPhrase = process.env.E2E_WALLET_SEED;

if (!walletPassword) {
  throw new Error("Missing E2E_WALLET_PASSWORD for Synpress wallet setup.");
}

if (!seedPhrase) {
  throw new Error("Missing E2E_WALLET_SEED for Synpress wallet setup.");
}

export default defineWalletSetup(walletPassword, async (context, walletPage) => {
  const extensionId = await getExtensionId(context, "MetaMask");
  const metamask = new MetaMask(context, walletPage, walletPassword, extensionId);

  await disableMetaMaskSidePanel(walletPage);
  await metamask.importWallet(seedPhrase);
  await completeOnboardingIfPresent(walletPage, metamask);
});
