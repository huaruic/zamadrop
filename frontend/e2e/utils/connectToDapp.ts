import type { BrowserContext, Page } from "@playwright/test";

async function getNotificationPage(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const notificationUrl = `chrome-extension://${extensionId}/notification.html`;
  const existingPage = context
    .pages()
    .find((page) => page.url().startsWith(notificationUrl));

  if (existingPage) {
    return existingPage;
  }

  return await context.waitForEvent("page", {
    predicate: (page) => page.url().startsWith(notificationUrl),
    timeout: 30_000,
  });
}

async function clickLastVisibleButton(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name }).last();
  await button.waitFor({ state: "visible", timeout: 30_000 });
  await button.click();
}

export async function connectToDappDefaultAccount(
  context: BrowserContext,
  extensionId: string,
) {
  const notificationPage = await getNotificationPage(context, extensionId);
  await notificationPage.waitForLoadState("domcontentloaded");

  await clickLastVisibleButton(notificationPage, /^(next|connect)$/i);
  await notificationPage.waitForTimeout(500);

  if (notificationPage.isClosed()) {
    return;
  }

  const finalButton = notificationPage
    .getByRole("button", { name: /^(connect|confirm)$/i })
    .last();

  if (await finalButton.isVisible().catch(() => false)) {
    await finalButton.click();
  }
}
