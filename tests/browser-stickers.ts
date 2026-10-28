// UI-only scenarios use synthetic API responses and never touch development users.
import { chromium, expect } from "@playwright/test";
import { createServer } from "../apps/web/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../apps/web/", import.meta.url));
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === "string") throw new Error("Vite did not start");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
const chatId = "019a0000-0000-7000-8000-000000000001";
const user = { id: "019a0000-0000-7000-8000-000000000002", name: "Тестовый пользователь", firstName: "Тестовый", lastName: "Пользователь", email: "user@example.com", role: "admin", banned: false };
const sticker = { id: "019a0000-0000-7000-8000-000000000003", fileId: "019a0000-0000-7000-8000-000000000004", label: "Привет", emojis: ["👋"], keywords: ["привет"] };
const pack = { id: "019a0000-0000-7000-8000-000000000005", name: "Тестовый набор", active: true, stickers: [sticker] };
try {
  for (const width of [1440, 390]) {
    pack.name = "Тестовый набор"; pack.stickers = [sticker]; sticker.emojis = ["👋"]; sticker.keywords = ["привет"];
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let messages: unknown[] = [];
    let catalogVersion = 1;
    let catalogReads = 0;
    await context.route("**/api/**", async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      let data: unknown = {};
      if (path === "/api/v1/admin/groups") data = [];
      else if (path === "/api/v1/me") data = user;
      else if (path === "/api/v1/users") data = [user];
      else if (path === "/api/v1/chats") data = [{ id: chatId, name: "Тестовый чат", title: "Тестовый чат", kind: "group", ownerId: user.id, unread: 0 }];
      else if (path === "/api/stickers") {
        catalogReads++;
        const etag = `"catalog-${catalogVersion}"`;
        if (request.headers()["if-none-match"] === etag) { await route.fulfill({ status: 304, headers: { ETag: etag } }); return; }
        await route.fulfill({ json: [pack], headers: { ETag: etag } }); return;
      }
      else if (path.endsWith(`/stickers/${sticker.id}`) && request.method() === "PATCH") { Object.assign(sticker, request.postDataJSON()); catalogVersion++; data = { ok: true }; }
      else if (path === `/api/stickers/${pack.id}` && request.method() === "PATCH") { pack.name = request.postDataJSON().name; catalogVersion++; data = { ok: true }; }
      else if (path === `/api/stickers/${pack.id}/stickers/${sticker.id}` && request.method() === "DELETE") { pack.stickers = []; catalogVersion++; data = { ok: true }; }
      else if (path.endsWith("/messages")) {
        if (request.method() === "POST") {
          const body = request.postDataJSON(); assert.equal(body.stickerId, sticker.id);
          messages = [{ id: sticker.id, chatId, authorId: user.id, authorName: user.name, clientMessageId: body.clientMessageId, type: "sticker", content: { text: sticker.label, fileId: sticker.fileId, stickerId: sticker.id }, createdAt: new Date().toISOString(), reactions: [] }];
          data = { id: sticker.id };
        } else data = { messages, hasMore: false };
      }
      await route.fulfill({ json: data });
    });
    await context.route("**/socket.io/**", route => route.abort());
    await context.route("**/media/**", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") }));
    await page.goto(`${base}/chats/${chatId}`);
    const previewPng = Buffer.from(await page.evaluate<string>(`(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4; const context = canvas.getContext('2d'); context.fillStyle = 'red'; context.fillRect(0, 0, 4, 4); return canvas.toDataURL('image/png').split(',')[1]; })()`), "base64");
    await page.getByLabel("Выбрать фото", { exact: true }).setInputFiles([
      { name: "first.png", mimeType: "image/png", buffer: previewPng },
      { name: "second.png", mimeType: "image/png", buffer: previewPng },
    ]);
    await expect(page.locator('.photo-preview canvas[data-ready="true"]')).toHaveCount(2);
    await page.getByRole("button", { name: "Убрать фото 2", exact: true }).click();
    await page.getByRole("button", { name: "Убрать фото 1", exact: true }).click();
    await expect(page.locator(".photo-preview")).toHaveCount(0);

    if (width < 780) { await page.getByLabel("Прикрепить", { exact: true }).click(); await page.getByRole("button", { name: "Стикер", exact: true }).click(); }
    else await page.getByRole("button", { name: "Выбрать стикер", exact: true }).click();
    await page.getByRole("button", { name: "Тестовый набор", exact: true }).click();
    await page.getByRole("textbox", { name: "Поиск стикеров", exact: true }).fill("👋");
    await page.getByRole("button", { name: "Отправить стикер Привет", exact: true }).click();
    await expect(page.locator(".message-sticker")).toBeVisible();
    assert.equal(await page.locator(".sticker-bubble").evaluate(node => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
    if (width < 780) { await page.getByLabel("Прикрепить", { exact: true }).click(); await page.getByRole("button", { name: "Стикер", exact: true }).click(); }
    else await page.getByRole("button", { name: "Выбрать стикер", exact: true }).click();
    await expect(page.getByRole("button", { name: "Отправить стикер Привет", exact: true })).toBeVisible();
    const dialog = page.getByRole("dialog");
    const box = await dialog.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
    await page.keyboard.press("Escape");
    if (await dialog.isVisible()) await dialog.getByRole("button", { name: /Закрыть/ }).click();
    const composer = page.getByRole("textbox", { name: "Сообщение", exact: true });
    const beforeSuggestions = await composer.boundingBox();
    await composer.fill("👋");
    const suggestion = page.getByRole("button", { name: "Предложенный стикер Привет", exact: true });
    await expect(suggestion).toBeVisible();
    const inputBounds = await composer.boundingBox();
    const suggestionsBounds = await page.getByLabel("Подходящие стикеры", { exact: true }).boundingBox();
    assert.ok(inputBounds && beforeSuggestions && inputBounds.width >= beforeSuggestions.width - 1, "suggestions never narrow the composer");
    assert.ok(inputBounds && suggestionsBounds && suggestionsBounds.y + suggestionsBounds.height <= inputBounds.y, "suggestions appear above the input");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "suggestions do not overflow the viewport");
    if (width < 780) {
      await suggestion.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 1, isPrimary: true });
      await expect(page.getByRole("img", { name: "Предпросмотр: Привет", exact: true })).toBeVisible();
      await suggestion.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 1, isPrimary: true });
      await expect(page.getByRole("img", { name: "Предпросмотр: Привет", exact: true })).toHaveCount(0);
      await suggestion.dispatchEvent("click");
      await expect(composer).toHaveValue("👋");
    }
    await suggestion.hover();
    await expect(page.getByRole("img", { name: "Предпросмотр: Привет", exact: true })).toBeVisible();
    await composer.fill("превет");
    await expect(suggestion).toBeVisible();
    await composer.fill("длинное сообщение привет");
    await expect(page.getByLabel("Подходящие стикеры", { exact: true })).toHaveCount(0);
    await composer.fill("люблю 👋");
    await expect(page.getByLabel("Подходящие стикеры", { exact: true })).toHaveCount(0);
    await composer.fill("👋👋");
    await expect(page.getByLabel("Подходящие стикеры", { exact: true })).toHaveCount(0);
    await composer.fill("превет");await expect(suggestion).toBeVisible();
    const reads = catalogReads;
    await composer.fill("привет");
    await expect(suggestion).toBeVisible();
    assert.equal(catalogReads, reads, "typing must not send draft text or repeat catalog requests");
    await suggestion.click();
    await expect(composer).toHaveValue("");
    if (width < 780) await page.getByRole("button", { name: "Назад к списку", exact: true }).click();
    await page.getByRole("button", { name: "Администрирование", exact: true }).click();
    await expect(page.getByRole("button", { name: "Отключить набор", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Стикеры", exact: true }).click();
    await expect(page).toHaveURL(`${base}/admin/stickers`);
    await expect(page.getByRole("heading", { name: "Стикеры", exact: true, level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Наборы стикеров", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Отключить набор", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Редактировать стикер Привет", exact: true }).click();
    await page.getByRole("textbox", { name: "Эмодзи стикера", exact: true }).fill("👋 🙂");
    await page.getByRole("textbox", { name: "Ключевые слова стикера", exact: true }).fill("привет, здравствуй");
    await page.getByRole("button", { name: "Сохранить метки", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Метки стикера", exact: true })).toHaveCount(0);
    assert.deepEqual(sticker.emojis, ["👋", "🙂"]);
    assert.deepEqual(sticker.keywords, ["привет", "здравствуй"]);
    await page.getByRole("button", { name: "Переименовать набор Тестовый набор", exact: true }).click();
    await page.getByRole("textbox", { name: "Новое название набора", exact: true }).fill("Новый набор");
    await page.getByRole("button", { name: "Сохранить название", exact: true }).click();
    await expect(page.getByText("Новый набор · 1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Удалить стикер Привет", exact: true }).click();
    await expect(page.getByText("Новый набор · 0", { exact: true })).toBeVisible();
    await expect(page.locator(".sticker-admin-tile")).toHaveCount(0);
    await page.goto(`${base}/chats/${chatId}`);
    await expect(page.locator(".message-sticker")).toBeVisible();
    if (width < 780) { await page.getByLabel("Прикрепить", { exact: true }).click(); await page.getByRole("button", { name: "Стикер", exact: true }).click(); }
    else await page.getByRole("button", { name: "Выбрать стикер", exact: true }).click();
    await expect(page.getByRole("button", { name: "Отправить стикер Привет", exact: true })).toHaveCount(0);
    await page.goto(`${base}/admin/stickers`);

    if (width < 780) {
      await expect(page.locator(".admin-sections")).toBeHidden();
      await page.getByRole("button", { name: "Назад к разделам", exact: true }).click();
      await expect(page).toHaveURL(`${base}/admin`);
    } else {
      await expect(page.locator(".admin-sections")).toBeVisible();
      assert.equal(await page.locator(".administration-shell").evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length), 3);
    }
    const menu = page.getByRole("navigation", { name: "Разделы администрирования" });
    await menu.getByRole("button", { name: "Пользователи", exact: true }).click();
    await expect(page).toHaveURL(`${base}/admin/users`);
    await expect(page.locator(".settings .user-row")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Наборы стикеров", exact: true })).toHaveCount(0);
    for (const [name, path] of [["Группы пользователей", "groups"], ["Групповые чаты", "chats"]]) {
      if (width < 780) await page.getByRole("button", { name: "Назад к разделам", exact: true }).click();
      await menu.getByRole("button", { name, exact: true }).click();
      await expect(page).toHaveURL(`${base}/admin/${path}`);
      await expect(page.getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`INFO sticker UI verified at ${width}px`);
  }
} finally { await browser.close(); await server.close(); }
