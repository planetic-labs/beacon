// Native fake camera/microphone recordings; synthetic API data, no development sessions.
import { chromium, expect } from "@playwright/test";
import { createServer } from "../apps/web/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { recordingFixture } from "./recording-fixtures";
const root = fileURLToPath(new URL("../apps/web/", import.meta.url));
const server = await createServer({ root, configFile: `${root}/vite.config.ts`, server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === "string") throw new Error("Vite did not start");
const base = `http://127.0.0.1:${address.port}`;
process.env.APP_URL = base;
process.env.APP_ENV = "test";
process.env.BETTER_AUTH_SECRET = "test-only-recording-secret-at-least-thirty-two-characters";
const { prepareRecording } = await import("../apps/api/src/modules/media/recording");
const processed = {
  audio: await prepareRecording(await recordingFixture("audio"), "audio"),
  circle: await prepareRecording(await recordingFixture("circle"), "circle"),
};
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const chatId = "019a0000-0000-7000-8000-000000000001";
const user = { id: "019a0000-0000-7000-8000-000000000002", name: "Тестовый пользователь", firstName: "Тестовый", lastName: "Пользователь", email: "user@example.com", role: "user", banned: false };
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", permissions: ["camera", "microphone"] });
    await context.addInitScript(`(() => { const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.recordingTracks = []; navigator.mediaDevices.getUserMedia = async options => { const stream = await original(options); window.recordingTracks.push(...stream.getTracks()); return stream; }; })()`);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const messages: Record<string, unknown>[] = [];
    const files = new Map<string, { bytes: Buffer; mime: string }>();
    let rejectedFirst = false;
    let firstClientId = "";
    await context.route("**/api/**", async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      let data: unknown = {};
      if (path === "/api/v1/me") data = user;
      else if (path === "/api/v1/users") data = [user];
      else if (path === "/api/v1/chats") data = [{ id: chatId, name: "Тестовый чат", title: "Тестовый чат", kind: "group", ownerId: user.id, unread: 0 }];
      else if (path.endsWith("/messages")) data = { messages, hasMore: false };
      else if (path === "/api/recordings") {
        const form = await new Request(`${base}/api/recordings`, { method: "POST", headers: { "content-type": request.headers()["content-type"] }, body: new Uint8Array(request.postDataBuffer()!).buffer }).formData();
        assert.equal(form.get("chatId"), chatId);
        const kind = String(form.get("kind")); const file = form.get("file"); assert.ok(file instanceof File && file.size > 0);
        if (!rejectedFirst) { rejectedFirst = true; firstClientId = String(form.get("clientMessageId")); await route.fulfill({ status: 500, json: { error: "Тест повторной отправки" } }); return; }
        if (!messages.length) assert.equal(form.get("clientMessageId"), firstClientId, "retry preserves message identity");
        const id = `019a0000-0000-7000-8000-${String(messages.length + 10).padStart(12, "0")}`;
        assert.ok(kind === "audio" || kind === "circle");
        files.set(id, { bytes: processed[kind].bytes, mime: processed[kind].mime });
        messages.push({ id, chatId, authorId: user.id, authorName: user.name, clientMessageId: form.get("clientMessageId"), type: kind, content: { text: kind === "audio" ? "Голосовое сообщение" : "Видеокружок", fileId: id, duration: 1 }, createdAt: new Date().toISOString(), reactions: [] });
        data = { id };
      }
      await route.fulfill({ json: data });
    });
    await context.route("**/socket.io/**", route => route.abort());
    await context.route("**/media/**", async route => {
      const file = files.get(new URL(route.request().url()).pathname.split("/").at(-1)!);
      if (!file) { await route.fulfill({ status: 404 }); return; }
      await route.fulfill({ contentType: file.mime, body: file.bytes });
    });
    await page.goto(`${base}/chats/${chatId}`);
    for (const kind of ["audio", "circle"]) {
      await page.getByRole("button", { name: kind === "audio" ? "Записать голосовое сообщение" : "Записать видеокружок", exact: true }).click();
      await page.getByRole("button", { name: "Начать запись", exact: true }).click();
      await expect(page.getByRole("button", { name: "Остановить запись", exact: true })).toBeVisible();
      await expect(page.locator(".recording-timer")).toContainText("0:01");
      await page.getByRole("button", { name: "Остановить запись", exact: true }).click();
      await expect(page.getByRole("button", { name: "Отправить запись", exact: true })).toBeVisible();
      assert.equal(await page.evaluate("window.recordingTracks.every(track => track.readyState === 'ended')"), true);
      if (kind === "audio") {
        await page.getByRole("button", { name: "Отправить запись", exact: true }).click();
        await expect(page.getByRole("button", { name: "Отправить запись", exact: true })).toBeEnabled();
      }
      await page.getByRole("button", { name: "Отправить запись", exact: true }).click();
      await expect(page.getByRole("button", { name: "Отправить запись", exact: true })).toHaveCount(0);
      const player = page.locator(kind === "audio" ? ".message-audio" : ".message-circle");
      await expect(player).toBeVisible();
      await expect.poll(() => player.evaluate(node => (node as HTMLMediaElement).readyState)).toBeGreaterThanOrEqual(2);
      if (kind === "audio") {
        await player.evaluate(node => (node as HTMLMediaElement).play());
        assert.equal(await player.evaluate(node => (node as HTMLMediaElement).paused), false);
        await player.evaluate(node => (node as HTMLMediaElement).pause());
      }
      if (kind === "circle") {
        await page.getByRole("button", { name: "Воспроизвести видеокружок", exact: true }).click();
        await expect(page.getByRole("button", { name: "Приостановить видеокружок", exact: true })).toBeVisible();
        assert.equal(await player.evaluate(node => getComputedStyle(node).borderRadius), "50%");
      }
    }
    // Cancellation stops every device without uploading anything.
    await page.getByRole("button", { name: "Записать видеокружок", exact: true }).click();
    await page.getByRole("button", { name: "Начать запись", exact: true }).click();
    await expect(page.getByRole("button", { name: "Остановить запись", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    assert.equal(await page.evaluate("window.recordingTracks.every(track => track.readyState === 'ended')"), true);
    assert.equal(messages.length, 2);
    await page.evaluate(`navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied by test', 'NotAllowedError'); }`);
    await page.getByRole("button", { name: "Записать голосовое сообщение", exact: true }).click();
    await page.getByRole("button", { name: "Начать запись", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Разрешите доступ к микрофону в настройках браузера");
    await expect(page.getByRole("button", { name: "Начать запись", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Отмена", exact: true }).click();

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await context.close(); console.log(`INFO voice and circle recording UI verified at ${width}px`);
  }
} finally { await browser.close(); await server.close(); }
