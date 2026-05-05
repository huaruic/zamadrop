import "../env";

import { test, expect } from "../fixtures/testWithConnectedMetaMask";

test.describe("MM4 Reject signature and retry", () => {
  test("shows error after rejection and allows retry", async ({
    page,
    metamask,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("wallet-session")).toBeVisible();

    await page.getByTestId("tab-recipient").click();
    const decryptButton = page.getByTestId("recipient-decrypt-button");
    await expect(decryptButton).toBeEnabled({ timeout: 30_000 });

    await decryptButton.click();
    await expect(decryptButton).toContainText("Awaiting wallet signature", {
      timeout: 60_000,
    });
    await metamask.rejectSignature();

    await expect(page.getByText(/rejected|denied|cancelled|canceled/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(decryptButton).toHaveText("Decrypt my amount");

    await decryptButton.click();
    await expect(decryptButton).toContainText("Awaiting wallet signature", {
      timeout: 60_000,
    });
    await metamask.confirmSignature();

    await expect(page.getByTestId("recipient-decrypted-amount")).toBeVisible({
      timeout: 120_000,
    });
  });
});
