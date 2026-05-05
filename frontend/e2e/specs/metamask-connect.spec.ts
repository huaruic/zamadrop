import "../env";

import { test, expect } from "../fixtures/testWithMetaMask";
import { connectToDappDefaultAccount } from "../utils/connectToDapp";

const adminAddress = process.env.E2E_ADMIN_ADDRESS?.toLowerCase();

if (!adminAddress) {
  throw new Error("Missing E2E_ADMIN_ADDRESS for MetaMask connect test.");
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

test.describe("MM1 Connect MetaMask", () => {
  test("connects wallet and shows the admin role in the header", async ({
    page,
    metamask,
  }) => {
    await page.goto("/");

    const connectButton = page
      .getByRole("button", { name: /connect metamask/i })
      .or(page.getByTestId("connect-wallet-metamask"));

    await expect(connectButton).toBeVisible();
    await connectButton.click();
    if (!metamask.extensionId) {
      throw new Error("Missing MetaMask extensionId.");
    }
    await connectToDappDefaultAccount(page.context(), metamask.extensionId);

    await expect(page.getByTestId("wallet-session")).toBeVisible();
    await expect(page.getByTestId("connected-address")).toHaveText(
      shortAddress(adminAddress),
    );
    await expect(page.getByTestId("connected-role")).toContainText("Admin");
    await expect(page.getByTestId("disconnect-wallet")).toBeVisible();
    await expect(page.getByTestId("wrong-chain-banner")).toHaveCount(0);
  });
});
