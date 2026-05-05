import "../env";

import { test, expect } from "../fixtures/testWithConnectedMetaMask";

test.describe("MM3 Auditor decrypt", () => {
  test("decrypts claimed total after MetaMask signature", async ({
    page,
    metamask,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("wallet-session")).toBeVisible();

    await page.getByTestId("tab-auditor").click();
    await expect(page.getByRole("heading", { name: "Auditor View" })).toBeVisible();

    const decryptButton = page.getByTestId("auditor-decrypt-button");
    await expect(decryptButton).toBeVisible();
    await expect(decryptButton).toBeEnabled({ timeout: 30_000 });

    await decryptButton.click();
    await expect(decryptButton).toContainText("Awaiting wallet signature", {
      timeout: 60_000,
    });

    await metamask.confirmSignature();

    await expect(page.getByTestId("auditor-decrypted-aggregate")).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByTestId("auditor-decrypted-aggregate")).toContainText("ZDT");
  });
});
