import type { Page } from "@playwright/test";
import type { MetaMask } from "@synthetixio/synpress/playwright";

export async function disableMetaMaskSidePanel(walletPage: Page) {
  await walletPage.addInitScript(() => {
    const markNonSidePanelBrowser = () => {
      document.documentElement.style.setProperty(
        "--arc-palette-title",
        "synpress-e2e",
      );
    };

    if (document.documentElement) {
      markNonSidePanelBrowser();
      return;
    }

    document.addEventListener("DOMContentLoaded", markNonSidePanelBrowser, {
      once: true,
    });
  });
}

export async function completeOnboardingIfPresent(
  walletPage: Page,
  metamask: MetaMask,
) {
  const completeButton = walletPage.locator(
    metamask.onboardingPage.selectors.WalletCreationSuccessPageSelectors
      .confirmButton,
  );

  if (!(await completeButton.isVisible().catch(() => false))) {
    return;
  }

  await walletPage.reload({ waitUntil: "domcontentloaded" });
  await completeButton.click();
  await completeButton.waitFor({ state: "hidden", timeout: 10_000 });
}
