import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, extname } from "node:path";

// Only a static test server and synthetic API responses; no deployment database.
const temporary = await mkdtemp(resolve(tmpdir(), "beacon-pwa-"));
const releases = [resolve(temporary, "one"), resolve(temporary, "two")];
const userId = "00000000-0000-4000-8000-000000000001";
const peerId = "00000000-0000-4000-8000-000000000002";
const chatId = "00000000-0000-4000-8000-000000000003";
const user = { id: userId, name: "Test User", firstName: "Test", lastName: "User", role: "user", banned: false };
const peer = { ...user, id: peerId, name: "Test Peer" };
const chat = { id: chatId, kind: "direct", peerId, name: peer.name, ownerId: userId, lastAt: "2026-01-01T00:00:00Z", unread: 0 };
let release = releases[0];
let breakInstall = false;
let assetRequests = 0;
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url!, "http://localhost").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (path.startsWith("/api/")) {
      response.setHeader("Content-Type", "application/json");
      const data = path === "/api/v1/me" ? user : path === "/api/v1/users" ? [user, peer]
        : path === "/api/v1/chats" ? [chat] : path === "/api/stickers" ? [] : { messages: [], hasMore: false };
      response.end(JSON.stringify(data)); return;
    }
    if (path.startsWith("/socket.io/") || path.startsWith("/media/") || path.startsWith("/.well-known/")) {
      response.writeHead(404); response.end(); return;
    }
    if (path.startsWith("/assets/")) {
      assetRequests++;
      if (breakInstall) { response.writeHead(503); response.end(); return; }
    }
    let filename = resolve(release, `.${path}`);
    if (!filename.startsWith(release + "/")) filename = resolve(release, "index.html");
    let content: Buffer;
    try { content = await readFile(filename); }
    catch {
      if (path.startsWith("/assets/")) { response.writeHead(404); response.end(); return; }
      filename = resolve(release, "index.html");
      content = await readFile(filename);
    }
    const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
    response.setHeader("Content-Type", mime[extname(filename)] ?? "application/octet-stream");
    response.end(content);
  } catch { response.writeHead(500); response.end(); }
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (const directory of releases)
    execFileSync("pnpm", ["exec", "vite", "build", "--outDir", directory], { cwd: resolve("apps/web"), stdio: "pipe" });
  const versions = await Promise.all(releases.map(async directory => {
    const worker = await readFile(resolve(directory, "sw.js"), "utf8");
    const match = worker.match(/const SHELL = (\{[^\n]+\});/);
    assert.ok(match, "Production worker must contain a shell manifest");
    return JSON.parse(match[1]) as { version: string; urls: string[] };
  }));
  assert.notEqual(versions[0].version, versions[1].version);
  assert.ok(versions.every(v => v.urls.includes("/index.html") && !v.urls.some(p => /^\/(?:api|media)\//.test(p))));
  await new Promise<void>(ready => server.listen(0, "127.0.0.1", ready));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/chats/${chatId}`);
  await expect(page.getByRole("textbox", { name: "Сообщение", exact: true })).toBeVisible();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cacheName = `beacon-shell-${versions[0].version}`;
  const cached = await page.evaluate(async name => (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname), cacheName);
  assert.deepEqual(cached.sort(), versions[0].urls.sort());
  const assetsBefore = assetRequests;
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Сообщение", exact: true })).toBeVisible();
  assert.equal(assetRequests, assetsBefore, "Reload uses cached assets");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#email")).toBeVisible();
  await page.goto(`${base}/settings/profile`);
  await expect(page.locator("#email")).toBeVisible();
  await page.goto(`${base}/chats/${chatId}`);
  await expect(page.locator("#email")).toBeVisible();
  const protectedPaths = ["/api/v1/me", "/api/auth/get-session", "/media/private.png", "/.well-known/openid-configuration"];
  for (const path of protectedPaths) {
    const ok = await page.evaluate(async path => { try { await fetch(path); return true; } catch { return false; } }, path);
    assert.equal(ok, false, "Private requests must not fall back to the shell cache");
  }
  await context.setOffline(false);
  await page.reload();
  const composer = page.getByRole("textbox", { name: "Сообщение", exact: true });
  await expect(composer).toBeVisible();
  await composer.fill("Unsaved test draft");
  const other = await context.newPage();
  await other.goto(`${base}/chats/${chatId}`);
  await expect(other.getByRole("textbox", { name: "Сообщение", exact: true })).toBeVisible();
  // A partial release must not replace the working shell.
  release = releases[1]; breakInstall = true;
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  await expect.poll(() => page.evaluate(async () => !(await navigator.serviceWorker.getRegistration())?.installing)).toBe(true);
  assert.ok(await page.evaluate(name => caches.has(name), cacheName));
  assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting), false);
  breakInstall = false;
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  await expect(page.getByRole("button", { name: "Обновить", exact: true })).toBeVisible();
  await expect(composer).toHaveValue("Unsaved test draft");
  let otherNavigations = 0;
  other.on("framenavigated", frame => { if (frame === other.mainFrame()) otherNavigations++; });
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Сообщение", exact: true })).toHaveValue("Unsaved test draft");
  await expect(page.getByRole("button", { name: "Обновить", exact: true })).toHaveCount(0);
  assert.equal(otherNavigations, 0, "Updating one tab must not reload another");
  assert.ok(await page.evaluate(name => caches.has(name), cacheName), "Old tab keeps its assets");
  await expect(other.getByRole("button", { name: "Обновить", exact: true })).toBeVisible();
  await other.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(other.getByRole("button", { name: "Обновить", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith("beacon-shell-"))))
    .toEqual([`beacon-shell-${versions[1].version}`]);
  console.log("PASS: production shell precache, offline startup, private-request isolation, failed-install rollback, explicit update, draft recovery, multiple tabs and old-cache cleanup");
} finally {
  await browser?.close();
  await new Promise<void>(done => server.close(() => done()));
  await rm(temporary, { recursive: true, force: true });
}
