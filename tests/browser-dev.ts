import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const base = process.env.APP_URL!;
const fixtures = JSON.parse(await readFile("/run/test/browser.json", "utf8"));
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
try {
  const context = await browser.newContext();
  const user = fixtures.users[1];
  await context.addCookies([{ name: user.cookieName, value: user.cookieValue, url: base }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let connected = false;
  page.on("websocket", socket => {
    if (new URL(socket.url()).pathname === "/__vite_hmr") socket.on("framereceived", event => {
      if (String(event.payload).includes('"type":"connected"')) connected = true;
    });
  });
  await page.route("**/socket.io/**", route => route.abort());
  await page.goto(`${base}/profile`);
  await expect(page.getByRole("heading", { name: "Push-уведомления", exact: true })).toBeVisible();
  await expect.poll(() => connected, { timeout: 15000 }).toBe(true);
  const source = await context.request.get(`${base}/src/main.tsx`);
  expect(source.status()).toBe(200);
  expect(await source.text()).toContain("RouterProvider");
  const privateSource = await context.request.get(`${base}/@fs/app/apps/api/src/modules/auth/config.ts`);
  expect(privateSource.status()).toBe(403);
  expect(await privateSource.text()).not.toContain("BETTER_AUTH_SECRET");
  const worker = await context.request.get(`${base}/sw.js`);
  expect(worker.headers()["cache-control"]).toBe("no-store");
  expect(errors).toEqual([]);
  console.log("INFO development checks passed: Fastify/Vite, HMR, direct routes and private source isolation");
} finally { await browser.close(); }
