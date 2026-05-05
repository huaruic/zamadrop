import { expect, test } from "@playwright/test";

test.describe("Role Boundary UI Guards", () => {
  test("public visitor sees public dashboard and no-wallet notice", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "ZamaDrop" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Public Dashboard" })).toBeVisible();
    await expect(page.getByText("隐私保证")).toBeVisible();

    const noWalletNotice = page.getByText("未检测到浏览器钱包扩展");
    const connectButton = page.getByRole("button", { name: /connect/i }).first();
    await expect(noWalletNotice.or(connectButton)).toBeVisible();
  });

  test("admin tab shows read-only notice without wallet", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("tab-admin").click();

    await expect(page.getByRole("heading", { name: "Admin Console" })).toBeVisible();
    await expect(
      page.getByText("连接 admin 钱包后可设置 allocation 和触发 finalize。"),
    ).toBeVisible();
    await expect(page.getByText("Declared Total")).toBeVisible();
    await expect(page.getByText("Recipients")).toBeVisible();
    await expect(page.getByText("Status")).toBeVisible();
  });

  test("recipient tab blocks unauthenticated users", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("tab-recipient").click();

    await expect(page.getByText("Recipient view")).toBeVisible();
    await expect(
      page.getByText("Connect your wallet to view your allocation."),
    ).toBeVisible();
  });

  test("auditor tab blocks unauthenticated users", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("tab-auditor").click();

    await expect(page.getByRole("heading", { name: "Auditor View" })).toBeVisible();
    await expect(
      page.getByText("Connect with auditor wallet to use this view."),
    ).toBeVisible();
  });
});
