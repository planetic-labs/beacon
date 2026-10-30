import type { Locator, Page } from "@playwright/test";
export async function messageAction(page: Page, message: Locator, name: string) {
  const row = await message.evaluate(node => node.matches(".message-group")) ? message : message.locator(".message-group");
  await row.hover();
  await message.getByRole("button", { name: "Действия с сообщением", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
