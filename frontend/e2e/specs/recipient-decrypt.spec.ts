import "../env";

import { test, expect } from "../fixtures/testWithConnectedMetaMask";

test.describe("MM2 Recipient decrypt", () => {
  test("decrypts recipient allocation after MetaMask signature", async ({
    page,
    metamask,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("wallet-session")).toBeVisible();

    await page.getByTestId("tab-recipient").click();
    await expect(page.getByRole("heading", { name: "Recipient" })).toBeVisible();

    const decryptButton = page.getByTestId("recipient-decrypt-button");
    await expect(decryptButton).toBeVisible();
    await expect(decryptButton).toBeEnabled({ timeout: 30_000 });

    await decryptButton.click();
    await expect(decryptButton).toContainText("Awaiting wallet signature", {
      timeout: 60_000,
    });

    await metamask.confirmSignature();

    await expect(page.getByTestId("recipient-decrypted-amount")).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId("recipient-decrypted-amount")).toContainText("ZDT");
  });
});
