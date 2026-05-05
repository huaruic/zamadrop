import "../env";

import { defineWalletSetup } from "@synthetixio/synpress";
import { MetaMask, getExtensionId } from "@synthetixio/synpress/playwright";
import { connectToDappDefaultAccount } from "../utils/connectToDapp";
import {
  completeOnboardingIfPresent,
  disableMetaMaskSidePanel,
} from "../wallet-setup/completeOnboarding";

const walletPassword = process.env.E2E_WALLET_PASSWORD;
const seedPhrase = process.env.E2E_WALLET_SEED;
const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";

if (!walletPassword) {
  throw new Error("Missing E2E_WALLET_PASSWORD for Synpress wallet setup.");
}

if (!seedPhrase) {
  throw new Error("Missing E2E_WALLET_SEED for Synpress wallet setup.");
}

export default defineWalletSetup(walletPassword, async (context, walletPage) => {
  const extensionId = await getExtensionId(context, "MetaMask");
  console.log("[connected.setup] extensionId:", extensionId);
  console.log("[connected.setup] baseUrl:", baseUrl);
  const metamask = new MetaMask(context, walletPage, walletPassword, extensionId);

  await disableMetaMaskSidePanel(walletPage);
  await metamask.importWallet(seedPhrase);
  await completeOnboardingIfPresent(walletPage, metamask);
  console.log("[connected.setup] wallet imported");

  const dappPage = await context.newPage();
  await dappPage.goto(baseUrl);
  console.log("[connected.setup] dapp page url:", dappPage.url());

  const connectButton = dappPage
    .getByRole("button", { name: /connect metamask/i })
    .or(dappPage.getByTestId("connect-wallet-metamask"));

  console.log(
    "[connected.setup] connect button visible:",
    await connectButton.isVisible().catch(() => false),
  );

  await connectButton.click();
  console.log("[connected.setup] connect button clicked");
  await connectToDappDefaultAccount(context, extensionId);

  await dappPage.getByTestId("wallet-session").waitFor({ timeout: 30_000 });
  console.log("[connected.setup] wallet session visible");
});
