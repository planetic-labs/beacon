import type { Locator, Page } from "@playwright/test";
export async function openMessageMenu(page: Page, message: Locator) {
  const row = await message.evaluate(node => node.matches(".message-group")) ? message : message.locator(".message-group");
  await row.hover();
  const trigger = row.getByRole("button", { name: "Действия с сообщением", exact: true });
  if (await trigger.isVisible()) await trigger.click();
  else {
    await row.scrollIntoViewIfNeeded();
    const bounds = await row.boundingBox();
    if (!bounds) throw new Error("Message has no bounds");
    await row.dispatchEvent("pointerdown", { pointerType: "touch", clientX: bounds.x + 8, clientY: bounds.y + bounds.height / 2 });
    await page.getByRole("menu", { name: "Действия с сообщением", exact: true }).waitFor();
    await row.dispatchEvent("pointerup", { pointerType: "touch" });
  }
}
export async function messageAction(page: Page, message: Locator, name: string) {
  await openMessageMenu(page, message);
  await page.getByRole("menuitem", { name, exact: true }).click();
}

// Mobile chat actions live inside the header menu; desktop actions stay visible.
export async function chatAction(page: Page, name: string) {
  const action = page.getByRole("button", { name, exact: true });
  if (!await action.isVisible()) await page.getByLabel("Действия с чатом", { exact: true }).click();
  await action.click();
}
