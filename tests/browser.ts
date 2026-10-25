import { chromium, expect as baseExpect, type APIResponse } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { io } from "socket.io-client";
import assert from "node:assert/strict";
import {v7} from "uuid";
import { request as httpRequest } from "node:http";
const base = process.env.APP_URL!,
  socketUrl = "http://localhost:51031";
const expect = baseExpect.configure({ timeout: 20000 });
const fixtures = JSON.parse(await readFile("/run/test/browser.json", "utf8"));
// Browsers omit Origin on same-origin polling; reject unrelated origins.
const polling = await new Promise<{status: number; body: string}>((resolve, reject) => {
  const req = httpRequest(`${socketUrl}/socket.io/?EIO=4&transport=polling`, {
    headers: { host: new URL(base).host, "sec-fetch-site": "same-origin" },
  }, (response) => {
    let body = "";
    response.on("data", (chunk) => { body += chunk; });
    response.on("end", () => resolve({status: response.statusCode!, body}));
  });
  req.on("error", reject);
  req.end();
});
assert.equal(polling.status, 200);
assert.match(polling.body, /^0\{/);
const foreign = await fetch(`${socketUrl}/socket.io/?EIO=4&transport=polling`, {
  headers: { origin: "https://unrelated.example.com" },
});
assert.equal(foreign.status, 403);
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const contexts = [];
  for (const u of fixtures.users) {
    const c = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await c.addCookies([
      { name: u.cookieName, value: u.cookieValue, url: base },
    ]);
    // Test ports are separate; the existing external Caddy performs this routing in deployments.
    await c.route("**/socket.io/**", async (route) => {
      try {
        const url = new URL(route.request().url());
        url.port = "51031";
        const response = await route.fetch({
          url: url.toString(),
          headers: { ...route.request().headers(), origin: base },
        });
        await route.fulfill({ response });
      } catch {
        await route.abort();
      }
    });
    contexts.push(c);
  }
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  // Sending through HTTP must work even when the notification channel is unavailable.
  await a.route("**/socket.io/**", (route) => route.abort());
  const failures: string[] = [];
  a.on("pageerror", (e) => failures.push(e.message));
  b.on("pageerror", (e) => failures.push(e.message));
  await Promise.all([a.goto(base), b.goto(base)]);
  await expect(
    a.getByRole("heading", { name: "Чаты", exact: true }),
  ).toBeVisible();
  await expect(
    b.getByRole("heading", { name: "Чаты", exact: true }),
  ).toBeVisible();
  await a.getByRole("button", { name: /Чат для технических моментов/ }).click();
  await b.getByRole("button", { name: /Чат для технических моментов/ }).click();
  await expect(a.locator(".bubble-text").first()).toContainText(
    "Добро пожаловать",
  );
  await a.screenshot({ path: "/run/test/desktop-chat.png" });
  await a
    .getByLabel("Сообщение", { exact: true })
    .fill("Браузерная проверка доставки");
  await a
    .getByRole("button", { name: "Отправить сообщение", exact: true })
    .click();
  await expect(
    a.locator(".bubble-text", { hasText: "Браузерная проверка доставки" }),
  ).toHaveCount(1);
  await expect(
    b.locator(".bubble-text", { hasText: "Браузерная проверка доставки" }),
  ).toHaveCount(1, { timeout: 25000 });
  const message = a.locator(".message-group", {
    hasText: "Браузерная проверка доставки",
  });
  await message.getByRole("button", { name: "Изменить", exact: true }).click();
  await a.getByLabel("Сообщение", { exact: true }).fill("Изменённый текст");
  await a.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(
    a.locator(".bubble-text", { hasText: "Изменённый текст" }),
  ).toHaveCount(1);
  await b
    .locator(".message-group", { hasText: "Изменённый текст" })
    .getByRole("button", { name: "Поставить реакцию" })
    .click();
  await b.getByRole("button", { name: "❤️", exact: true }).click();
  await expect(b.locator(".reaction-pill")).toContainText("❤️");
  await b
    .locator(".message-group", { hasText: "Изменённый текст" })
    .getByRole("button", { name: "Ответить", exact: true })
    .click();
  await b
    .getByLabel("Сообщение", { exact: true })
    .fill("Ответ из второго браузера");
  await b
    .getByRole("button", { name: "Отправить сообщение", exact: true })
    .click();
  await expect(b.locator(".message-quote")).toContainText("Изменённый текст");
  for (const width of [390, 320]) {
    await a.setViewportSize({ width, height: width === 390 ? 844 : 760 });
    await expect(
      a.getByRole("button", { name: "Назад к списку" }),
    ).toBeVisible();
    assert.ok(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await a.screenshot({ path: `/run/test/mobile-${width}-chat.png` });
  }
  await a.getByRole("button", { name: "Назад к списку" }).click();
  await expect(
    a.getByRole("heading", { name: "Чаты", exact: true }),
  ).toBeVisible();
  await a.screenshot({ path: "/run/test/mobile-list.png" });
  await a.setViewportSize({ width: 1440, height: 900 });
  await expect(a.locator(".app")).toHaveAttribute("data-device","desktop");
  await a.locator(".nav-rail").getByRole("button", { name: "Профиль", exact: true }).click();
  const cdp = await contexts[0].newCDPSession(a);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await a.getByRole("button", { name: "Добавить ключ доступа" }).click();
  await expect(a.getByText("Мой ключ доступа", { exact: true })).toBeVisible();
  await a.getByRole("button", { name: "Выйти из аккаунта" }).click();
  await a.getByRole("button", { name: "Войти с ключом доступа" }).click();
  await expect(
    a.getByRole("heading", { name: "Чаты", exact: true }),
  ).toBeVisible();
  assert.deepEqual(failures, []);
  console.log(
    "INFO browser checks passed: desktop, mobile, messages, reactions, replies, passkey",
  );
  // Verify a real WebSocket connection separately from browser test-port routing.
  const cookies = await contexts[0].cookies(base);
  const socket = io(socketUrl, {
    transports: ["websocket"],
    extraHeaders: {
      origin: base,
      cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    },
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("WebSocket timeout")),
      10000,
    );
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", reject);
  });
  assert.ok(socket.connected);
  const delivered=new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("Outbox event timeout")),10000);
    socket.on("chat.changed",({chatId})=>{if(chatId===fixtures.chatId){clearTimeout(timer);resolve()}});
  });
  const eventResponse=await contexts[0].request.post(`${base}/api/v1/chats/${fixtures.chatId}/messages`,{headers:{origin:base},data:{text:"Проверка события WebSocket",clientMessageId:v7()}});
  assert.equal(eventResponse.status(),200);await delivered;
  // More than one page is missed: reconnection must recover the entire gap.
  await contexts[1].setOffline(true);
  for(let i=0;i<60;i++){
    const r: APIResponse=await contexts[0].request.post(`${base}/api/v1/chats/${fixtures.chatId}/messages`,{headers:{origin:base},data:{text:`Восстановление истории ${i}`,clientMessageId:v7()}});
    assert.equal(r.status(),200);
  }
  await contexts[1].setOffline(false);
  await expect(b.locator(".bubble-text",{hasText:/^Восстановление истории /})).toHaveCount(60,{timeout:30000});
  socket.disconnect();
  console.log("INFO authenticated WebSocket delivery and 60-message reconnect recovery passed");
} catch(error) {
  const page=browser.contexts()[0]?.pages()[0];
  if(page){await page.screenshot({path:"/run/test/browser-failure.png"});console.log("UI state",await page.evaluate(()=>({width:innerWidth,device:document.querySelector('.app')?.getAttribute('data-device')})))}
  throw error;
} finally {
  await browser.close();
}
