import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import { auth } from "../apps/api/src/modules/auth/config";
import { db, pool } from "../apps/api/src/db";
import { getAuthTables } from "better-auth/db";
import * as schema from "../apps/api/src/db/schema";
import { getTableColumns } from "drizzle-orm";
import { recordingFixture } from "./recording-fixtures";
import { pushScenarios } from "./push-scenarios";
import { createApp } from "../apps/api/src/http/server";
import type { HTTPMethods } from "fastify";
const appPromise = createApp({ serveWeb: false });
async function http(request: Request): Promise<Response> {
  const app = await appPromise;
  const url = new URL(request.url);
  const result = await app.inject({ method: request.method as HTTPMethods, url: url.pathname + url.search,
    headers: Object.fromEntries(request.headers),
    payload: ["GET", "HEAD"].includes(request.method) ? undefined : Buffer.from(await request.arrayBuffer()),
  });
  const headers = new Headers();
  for (const [key, values] of Object.entries(result.headers)) {
    if (values !== undefined) for (const value of Array.isArray(values) ? values : [values]) headers.append(key, String(value));
  }
  return new Response([204, 304].includes(result.statusCode) ? null : new Uint8Array(result.rawPayload), { status: result.statusCode, headers });
}
const authPost = http, metadata = http, uploadAvatar = http;
const readMedia = (request: Request, _context: unknown) => http(request);

const base = process.env.APP_URL!;
const emails = [
  `admin-${v7()}@example.com`,
  `one-${v7()}@example.com`,
  `two-${v7()}@example.com`,
];
let sentCode = "";
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (String(input) === "https://api.resend.com/emails") {
    sentCode = JSON.parse(String(init?.body)).text.match(/\d{6}/)[0];
    return Response.json({ id: v7() });
  }
  return realFetch(input, init);
};
process.env.RESEND_API_KEY = "test-only";
process.env.EMAIL_FROM = "test@example.com";
const ids = [v7(), v7(), v7()];
let requestNumber = 1;
async function authReq(path: string, body: unknown, cookie?: string) {
  return http(
    new Request(`${base}/api/auth/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: base,
        "x-forwarded-for": `192.0.2.${requestNumber++}`,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}
async function login(email: string) {
  sentCode = "";
  const sent = await authReq("email-otp/send-verification-otp", {
    email,
    type: "sign-in",
  });
  assert.equal(sent.status, 200, await sent.text());
  assert.match(sentCode, /^\d{6}$/);
  const r = await authReq("sign-in/email-otp", { email, otp: sentCode });
  assert.equal(r.status, 200, await r.clone().text());
  const cookies = r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.ok(cookies);
  return cookies;
}
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
) {
  const req = new Request(`${base}/api/v1/${path}`, {
    method,
    headers: {
      origin: base,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return http(req);
}
after(async () => {
  globalThis.fetch = realFetch;
  await (await appPromise).close();
  await pool.end();
});

test("Better Auth schema matches the pinned plugins", () => {
  const tables = getAuthTables(auth.options);
  for (const [name, table] of Object.entries(tables)) {
    const model = table.modelName ?? name;
    const target = (schema as any)[model];
    assert.ok(target, `Missing model ${model}`);
    const columns = getTableColumns(target);
    for (const field of Object.keys(table.fields))
      assert.ok(field in columns, `Missing ${model}.${field}`);
  }
});

test("closed registration, chat invariants, access control, blocking and OIDC", async () => {
  assert.equal(
    process.env.APP_ENV,
    "test",
    "Integration suite requires a disposable test deployment",
  );
  await db.execute(
    sql`truncate "user",membership_group,oauth_client,verification,rate_limit,outbox,jwks cascade`,
  );
  for (let i = 0; i < ids.length; i++)
    await db.execute(
      sql`insert into "user"(id,name,first_name,last_name,email,role) values(${ids[i]},${"Test " + i},'Test',${String(i)},${emails[i]},${i === 0 ? "admin" : "user"})`,
    );
  const missing = await http(new Request(`${base}/api/not-a-route`, { headers: { accept: "text/html" } }));
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type")!, /application\/json/);
  const deniedOrigin = await http(new Request(`${base}/api/v1/me`, { method: "PATCH", headers: { origin: "https://unrelated.example.com", "content-type": "application/json" }, body: "{}" }));
  assert.equal(deniedOrigin.status, 403);
  const oversized = await http(new Request(`${base}/api/v1/me`, { method: "PATCH", headers: { origin: base, "content-type": "application/json" }, body: "x".repeat(6 * 1024 * 1024 + 1) }));
  assert.equal(oversized.status, 413);
  const cookie = await login(emails[0]),
    one = await login(`  ${emails[1].toUpperCase()}  `),
    two = await login(emails[2]);
  assert.equal((await call("me", "GET", undefined, cookie)).status, 200);
  const people = await (await call("users", "GET", undefined, one)).json();
  assert.ok(people.every((p: any) => !("email" in p) && !("role" in p)));
  const keyOptions = await http(new Request(`${base}/api/auth/passkey/generate-register-options?name=Android`, { headers: { cookie: one } }));
  assert.equal(keyOptions.status, 200);
  const keyRegistration = await keyOptions.json();
  assert.equal(keyRegistration.user.name, emails[1]);
  assert.equal(keyRegistration.user.displayName, emails[1]);
  const keyId = v7();
  await db.execute(sql`insert into passkey(id,name,public_key,user_id,credential_id,counter,device_type,backed_up)
    values(${keyId},'Android','test-fixture',${ids[1]},${v7()},0,'singleDevice',false)`);
  const renamed = await authReq("passkey/update-passkey", { id: keyId, name: "Samsung" }, one);
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).passkey.name, "Samsung");
  const forbiddenRename = await authReq("passkey/update-passkey", { id: keyId, name: "Other account" }, two);
  assert.ok([401, 403].includes(forbiddenRename.status));
  const emptyRename = await authReq("passkey/update-passkey", { id: keyId, name: " " }, one);
  assert.equal(emptyRename.status, 400);
  const unknown = `unknown-${v7()}@example.com`;
  sentCode = "";
  assert.equal(
    (
      await authReq("email-otp/send-verification-otp", {
        email: unknown,
        type: "sign-in",
      })
    ).status,
    200,
  );
  assert.equal(sentCode, "");
  assert.equal(
    (await db.execute(sql`select id from "user" where email=${unknown}`))
      .rowCount,
    0,
  );
  assert.notEqual(
    (
      await authPost(
        new Request(`${base}/api/auth/admin/remove-user`, {
          method: "POST",
          headers: { origin: base, cookie, "content-type": "application/json" },
          body: JSON.stringify({ userId: ids[1] }),
        }),
      )
    ).status,
    200,
  );
  const direct = await Promise.all(
    Array.from({ length: 5 }, async () => {
      const r = await call(
        "chats",
        "POST",
        { kind: "direct", userIds: [ids[2]] },
        one,
      );
      assert.equal(r.status, 200, await r.clone().text());
      return (await r.json()).id;
    }),
  );
  assert.equal(new Set(direct).size, 1);
  const chatId = direct[0];
  assert.equal(
    (await call(`chats/${chatId}/messages`, "GET", undefined, cookie)).status,
    403,
    "admin cannot read other direct chats",
  );
  const retryId = v7();
  const sent = await Promise.all(
    Array.from({ length: 5 }, () =>
      call(
        `chats/${chatId}/messages`,
        "POST",
        { clientMessageId: retryId, text: "Hello" },
        one,
      ),
    ),
  );
  assert.ok(sent.every((r) => r.status === 200));
  const m = (await sent[0].json()).id;
  assert.equal(
    (
      await db.execute(
        sql`select id from message where client_message_id=${retryId}`,
      )
    ).rowCount,
    1,
  );
  assert.equal(
    (await call(`messages/${m}`, "PATCH", { text: "Not mine" }, two)).status,
    403,
  );
  assert.equal(
    (await call(`messages/${m}`, "PATCH", { text: "Edited" }, one)).status,
    200,
  );
  for (const emoji of ["❤️", "👍"])
    assert.equal(
      (await call(`messages/${m}/reaction`, "PATCH", { emoji }, two)).status,
      200,
    );
  const rs = await db.execute(
    sql`select * from reaction where message_id=${m} and user_id=${ids[2]}`,
  );
  assert.equal(rs.rowCount, 1);
  assert.equal(rs.rows[0].emoji, "👍");
  const groupResult = await call(
    "chats",
    "POST",
    { kind: "group", title: "Test group", userIds: [ids[2]] },
    one,
  );
  assert.equal(groupResult.status, 200);
  const group = (await groupResult.json()).id;
  assert.equal(
    (await call(`chats/${group}`, "PATCH", { title: "Managed" }, cookie))
      .status,
    200,
  );
  assert.equal(
    (await call(`chats/${group}/messages`, "GET", undefined, cookie)).status,
    403,
    "management does not grant reading",
  );
  assert.equal(
    (
      await call(
        `chats/${group}/messages`,
        "POST",
        { text: "Forward", clientMessageId: v7(), forwardId: m },
        two,
      )
    ).status,
    200,
  );
  assert.equal(
    (await call(`chats/${group}`, "PATCH", { leave: true }, one)).status,
    409,
  );
  assert.equal(
    (await call(`chats/${group}`, "PATCH", { remove: ids[2] }, one)).status,
    200,
  );
  assert.equal(
    (await call(`chats/${group}/messages`, "GET", undefined, two)).status,
    403,
  );
  assert.equal(
    (await call(`chats/${group}`, "PATCH", { add: ids[2] }, one)).status,
    200,
  );
  const restored = await (
    await call(`chats/${group}/messages`, "GET", undefined, two)
  ).json();
  assert.equal(restored.messages[0].content.text, "Edited");
  assert.ok(restored.messages[0].forwardedFrom);
  const badReply = await call(
    `chats/${group}/messages`,
    "POST",
    { text: "Invalid", clientMessageId: v7(), replyToId: m },
    one,
  );
  assert.equal(badReply.status, 400);
  // A permitted client receives the stable subject and explicit profile/group claims.
  const g = v7();
  await db.execute(
    sql`insert into membership_group(id,code,name) values(${g},${"test_" + v7()},'Test membership')`,
  );
  await db.execute(
    sql`insert into group_member(group_id,user_id) values(${g},${ids[1]})`,
  );
  const client = await auth.api.adminCreateOAuthClient({
    headers: new Headers({ cookie }),
    body: {
      redirect_uris: ["https://client.example.com/callback"],
      scope: "openid profile email groups",
      skip_consent: true,
      require_pkce: true,
      client_secret_expires_at: 0,
    },
  });
  const meta = await metadata(
    new Request(`${base}/.well-known/openid-configuration`),
  );
  assert.equal(meta.status, 200);
  const discovery = await meta.json();
  assert.ok(discovery.authorization_endpoint);
  const verifier = randomBytes(32).toString("base64url"),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const q = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: "https://client.example.com/callback",
    response_type: "code",
    scope: "openid profile email groups",
    state: "test-state",
    nonce: "test-nonce",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const authorize = await http(
    new Request(`${discovery.authorization_endpoint}?${q}`, {
      headers: { cookie: one, accept: "text/html" },
    }),
  );
  assert.ok(
    [302, 303].includes(authorize.status),
    await authorize.clone().text(),
  );
  const location = authorize.headers.get("location")!;
  assert.ok(
    location.startsWith("https://client.example.com/callback"),
    location,
  );
  const authCode = new URL(location).searchParams.get("code");
  assert.ok(authCode);
  const token = await http(
    new Request(discovery.token_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authCode,
        redirect_uri: "https://client.example.com/callback",
        code_verifier: verifier,
      }),
    }),
  );
  assert.equal(token.status, 200, await token.clone().text());
  const tokens = await token.json();
  assert.ok(tokens.id_token);
  const info = await http(
    new Request(discovery.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    }),
  );
  assert.equal(info.status, 200, await info.clone().text());
  const identity = await info.json();
  assert.equal(identity.sub, ids[1]);
  assert.equal(identity.given_name, "Test");
  assert.equal(identity.email, emails[1]);
  assert.equal(identity.groups.length, 1);
  assert.equal(identity.role, "user");
  // A user without a Beacon session must return to the OIDC client after OTP login.
  const freshQuery = new URLSearchParams(q);
  freshQuery.set("state", "fresh-login-state");
  const needsLogin = await http(new Request(`${discovery.authorization_endpoint}?${freshQuery}`, {
    headers: { accept: "text/html" },
  }));
  const loginLocation = new URL(needsLogin.headers.get("location")!, base);
  assert.equal(loginLocation.origin, new URL(base).origin);
  assert.equal(loginLocation.pathname, "/");
  const oauth_query = loginLocation.search.slice(1);
  await authReq("email-otp/send-verification-otp", { email: emails[1], type: "sign-in", oauth_query });
  const resumed = await authReq("sign-in/email-otp", { email: emails[1], otp: sentCode, oauth_query });
  assert.equal(resumed.status, 200);
  const continued = await resumed.json();
  assert.equal(continued.redirect, true);
  const destination = new URL(continued.url);
  assert.equal(destination.origin, "https://client.example.com");
  assert.equal(destination.searchParams.get("state"), "fresh-login-state");
  assert.ok(destination.searchParams.get("code"));
  // Cursor pagination must preserve timestamp precision and never skip or duplicate rows.
  await db.execute(
    sql`insert into message(chat_id,author_id,client_message_id,content) select ${chatId},${ids[1]},uuidv7(),jsonb_build_object('text','history-'||n) from generate_series(1,65) n`,
  );
  const page1 = await (
    await call(`chats/${chatId}/messages`, "GET", undefined, one)
  ).json();
  assert.equal(page1.messages.length, 50);
  assert.equal(page1.hasMore, true);
  const cursor = page1.messages[0];
  const page2 = await (
    await call(
      `chats/${chatId}/messages?beforeId=${cursor.id}&beforeAt=${encodeURIComponent(cursor.createdAt)}`,
      "GET",
      undefined,
      one,
    )
  ).json();
  assert.equal(page2.messages.length, 16);
  assert.equal(page2.hasMore, false);
  assert.equal(
    new Set([...page1.messages, ...page2.messages].map((m) => m.id)).size,
    66,
  );
  const after = await (
    await call(
      `chats/${chatId}/messages?afterId=${page2.messages.at(-1).id}&afterAt=${encodeURIComponent(page2.messages.at(-1).createdAt)}`,
      "GET",
      undefined,
      one,
    )
  ).json();
  assert.equal(after.messages.length, 50);
  assert.equal(after.hasMore, false);
  // Avatar bytes remain on the local storage backend and require authentication.
  const sharp = createRequire(new URL("../apps/api/package.json", import.meta.url))("sharp") as typeof import("../apps/api/node_modules/sharp").default;
  const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: "transparent" } }).png().toBuffer();
  const form = new FormData();
  form.set("file", new File([png], "avatar.png", { type: "image/png" }));
  const uploaded = await uploadAvatar(
    new Request(`${base}/api/avatar`, {
      method: "POST",
      headers: { origin: base, cookie: one },
      body: form,
    }),
  );
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  const url = (await uploaded.json()).url;
  const fileId = url.split("/").at(-1);
  const media = await readMedia(
    new Request(`${base}${url}`, { headers: { cookie: two } }),
    { params: Promise.resolve({ id: fileId }) },
  );
  assert.equal(media.status, 200);
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), png);
  assert.equal(
    (
      await readMedia(new Request(`${base}${url}`), {
        params: Promise.resolve({ id: fileId }),
      })
    ).status,
    404,
  );
  const forbidden = new FormData();
  forbidden.set("file", new File([png], "avatar.png"));
  forbidden.set("userId", ids[0]);
  assert.equal(
    (
      await uploadAvatar(
        new Request(`${base}/api/avatar`, {
          method: "POST",
          headers: { origin: base, cookie: one },
          body: forbidden,
        }),
      )
    ).status,
    403,
  );
  // Photos are private to current chat members, and forwarding grants access in the destination.
  const photoClientId = v7();
  async function uploadPhoto(cookieValue: string, bytes = png) {
    const data = new FormData();
    data.set("file", new File([bytes], "photo.png", { type: "image/png" }));
    data.set("chatId", chatId); data.set("clientMessageId", photoClientId);
    return http(new Request(`${base}/api/photos`, { method: "POST", headers: { origin: base, cookie: cookieValue }, body: data }));
  }
  assert.equal((await uploadPhoto(cookie)).status, 403);
  assert.equal((await uploadPhoto(one, Buffer.from("not an image"))).status, 400);
  const photoResponse = await uploadPhoto(one);
  assert.equal(photoResponse.status, 200, await photoResponse.clone().text());
  const photoMessageId = (await photoResponse.json()).id;
  const photoChats = await call("chats", "GET", undefined, one);
  assert.equal(photoChats.status, 200, await photoChats.clone().text());
  const photoChat = (await photoChats.json()).find((c: { id: string; preview: string }) => c.id === chatId);
  assert.equal(photoChat.preview, "Фото");
  const replay = await uploadPhoto(one);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).id, photoMessageId);
  const photoHistory = await (await call(`chats/${chatId}/messages`, "GET", undefined, one)).json();
  const photoMessage = photoHistory.messages.find((m: { id: string; type: string; content: { fileIds: string[] } }) => m.id === photoMessageId);
  assert.equal(photoMessage.type, "photo");
  const photoUrl = `${base}/media/${photoMessage.content.fileIds[0]}`;
  assert.equal((await http(new Request(photoUrl, { headers: { cookie } }))).status, 404);
  const photoFile = await http(new Request(photoUrl, { headers: { cookie: two } }));
  assert.equal(photoFile.status, 200);
  assert.deepEqual(Buffer.from(await photoFile.arrayBuffer()), png);
  const forwardedPhoto = await call(`chats/${group}/messages`, "POST", { clientMessageId: v7(), text: "", forwardId: photoMessageId }, one);
  assert.equal(forwardedPhoto.status, 200, await forwardedPhoto.clone().text());
  assert.equal((await call(`messages/${photoMessageId}`, "PATCH", { text: "Подпись" }, one)).status, 200);
  assert.equal((await http(new Request(photoUrl, { headers: { cookie: two } }))).status, 200);
  const albumClientId = v7();
  async function uploadAlbum(count: number, invalidLast = false, clientId = albumClientId) {
    const data = new FormData();
    data.set("chatId", chatId); data.set("clientMessageId", clientId); data.set("text", "Альбом");
    for (let i = 0; i < count; i++) data.append("file", new File([invalidLast && i === count - 1 ? Buffer.from("invalid") : png], `photo-${i}.png`));
    return http(new Request(`${base}/api/photos`, { method: "POST", headers: { origin: base, cookie: one }, body: data }));
  }
  const fileCountBefore = Number((await db.execute(sql`select count(*) as n from media_file`)).rows[0].n);
  assert.equal((await uploadAlbum(11)).status, 400);
  assert.equal((await uploadAlbum(2, true)).status, 400);
  assert.equal(Number((await db.execute(sql`select count(*) as n from media_file`)).rows[0].n), fileCountBefore);
  const albumResponse = await uploadAlbum(3);
  assert.equal(albumResponse.status, 200, await albumResponse.clone().text());
  const albumId = (await albumResponse.json()).id;
  const albumReplay = await uploadAlbum(3);
  assert.equal((await albumReplay.json()).id, albumId);
  assert.equal(Number((await db.execute(sql`select count(*) as n from media_file`)).rows[0].n), fileCountBefore + 3);
  const albumHistory = await (await call(`chats/${chatId}/messages`, "GET", undefined, one)).json();
  const album = albumHistory.messages.find((m: { id: string; content: { fileIds: string[]; text: string } }) => m.id === albumId);
  assert.equal(album.content.fileIds.length, 3);
  assert.equal(album.content.text, "Альбом");
  for (const id of album.content.fileIds) {
    assert.equal((await http(new Request(`${base}/media/${id}`, { headers: { cookie: two } }))).status, 200);
    assert.equal((await http(new Request(`${base}/media/${id}`, { headers: { cookie } }))).status, 404);
  }
  assert.equal((await call(`messages/${albumId}`, "PATCH", { text: "Новая подпись", fileIds: [v7()] }, one)).status, 200);
  const albumForward = await call(`chats/${group}/messages`, "POST", { clientMessageId: v7(), text: "", forwardId: albumId }, one);
  assert.equal(albumForward.status, 200);
  const forwardedHistory = await (await call(`chats/${group}/messages`, "GET", undefined, one)).json();
  const forwardedId = (await albumForward.json()).id;
  const forwardedAlbum = forwardedHistory.messages.find((m: { id: string; content: { fileIds: string[]; text: string } }) => m.id === forwardedId);
  assert.deepEqual(forwardedAlbum.content.fileIds, album.content.fileIds);
  // Check the persisted source retains every attachment when editing its caption.
  const persisted = (await db.execute(sql`select content from message where id=${albumId}`)).rows[0].content as { fileIds: string[] };
  assert.deepEqual(persisted.fileIds, album.content.fileIds);
  // Single-photo messages saved before albums remain readable.
  await db.execute(sql`update message set content=jsonb_build_object('text','','fileId',${photoMessage.content.fileIds[0]}::text) where id=${photoMessageId}`);
  assert.equal((await http(new Request(photoUrl, { headers: { cookie: two } }))).status, 200);
  const largeAlbum = new FormData();
  largeAlbum.set("chatId", chatId); largeAlbum.set("clientMessageId", v7());
  const largePng = Buffer.concat([png, Buffer.alloc(3200 * 1024)]);
  for (let i = 0; i < 2; i++) largeAlbum.append("file", new File([largePng], `large-${i}.png`));
  const largeResponse = await http(new Request(`${base}/api/photos`, { method: "POST", headers: { origin: base, cookie: one }, body: largeAlbum }));
  assert.equal(largeResponse.status, 200, "albums can exceed the default 6 MB request limit");
  async function stickerRequest(path = "", method = "GET", body?: unknown, session = cookie) {
    return http(new Request(`${base}/api/stickers${path}`, { method, headers: { origin: base, cookie: session, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  }
  assert.equal((await stickerRequest("", "POST", { name: "Forbidden" }, one)).status, 403);
  const createdPack = await stickerRequest("", "POST", { name: "Тестовый набор" });
  assert.equal(createdPack.status, 200, await createdPack.clone().text());
  const packId = (await createdPack.json()).id;
  async function stickerUpload(session: string, bytes = png) {
    const data = new FormData();
    data.append("file", new File([bytes], "hello.png", { type: "image/png" }));
    data.append("file", new File([png], "goodbye.png", { type: "image/png" }));
    return http(new Request(`${base}/api/stickers/${packId}`, { method: "POST", headers: { origin: base, cookie: session }, body: data }));
  }
  assert.equal((await stickerUpload(one)).status, 403);
  assert.equal((await stickerUpload(cookie, Buffer.from("bad"))).status, 400);
  const stickerSource = await sharp(randomBytes(1024 * 768 * 4), { raw: { width: 1024, height: 768, channels: 4 } }).png().toBuffer();
  const stickerUploaded = await stickerUpload(cookie, stickerSource);
  assert.equal(stickerUploaded.status, 200, await stickerUploaded.clone().text());
  const packsResponse = await stickerRequest("", "GET", undefined, one);
  assert.equal(packsResponse.status, 200);
  const pack = (await packsResponse.json()).find((p: { id: string; stickers: { id: string; fileId: string; label: string }[] }) => p.id === packId);
  assert.equal(pack.stickers.length, 2);
  const sticker = pack.stickers[0];
  const processedResponse = await http(new Request(`${base}/media/${sticker.fileId}`, { headers: { cookie: two } }));
  assert.equal(processedResponse.headers.get("content-type"), "image/webp");
  const processedBytes = Buffer.from(await processedResponse.arrayBuffer());
  const processedMetadata = await sharp(processedBytes).metadata();
  assert.equal(processedMetadata.width, 512);
  assert.equal(processedMetadata.height, 384);
  assert.equal(processedMetadata.hasAlpha, true);
  assert.ok(processedBytes.length < stickerSource.length);

  const stickerClientId = v7();
  const stickerSent = await call(`chats/${chatId}/messages`, "POST", { clientMessageId: stickerClientId, stickerId: sticker.id, text: "Forged label" }, one);
  assert.equal(stickerSent.status, 200, await stickerSent.clone().text());
  const stickerMessageId = (await stickerSent.json()).id;
  const stickerHistory = await (await call(`chats/${chatId}/messages`, "GET", undefined, two)).json();
  const stickerMessage = stickerHistory.messages.find((m: { id: string; type: string; content: { text: string; fileId: string } }) => m.id === stickerMessageId);
  assert.equal(stickerMessage.type, "sticker");
  assert.equal(stickerMessage.content.text, sticker.label);
  assert.equal(stickerMessage.content.fileId, sticker.fileId);
  const stickerChats = await call("chats", "GET", undefined, one);
  assert.equal(stickerChats.status, 200);
  assert.equal((await stickerChats.json()).find((c: { id: string; preview: string }) => c.id === chatId).preview, `Стикер: ${sticker.label}`);
  assert.equal((await call(`messages/${stickerMessageId}`, "PATCH", { text: "Changed" }, one)).status, 400);
  assert.equal((await call(`messages/${stickerMessageId}/reaction`, "PATCH", { emoji: "❤️" }, two)).status, 200);
  assert.equal((await stickerRequest(`/${packId}`, "PATCH", { active: false }, one)).status, 403);
  assert.equal((await stickerRequest(`/${packId}`, "PATCH", { active: false })).status, 200);
  assert.equal((await (await stickerRequest("", "GET", undefined, one)).json()).some((p: { id: string }) => p.id === packId), false);
  assert.equal((await (await stickerRequest()).json()).find((p: { id: string; active: boolean }) => p.id === packId).active, false);
  assert.equal((await call(`chats/${chatId}/messages`, "POST", { clientMessageId: v7(), stickerId: sticker.id, text: "" }, one)).status, 400);
  const stickerReplay = await call(`chats/${chatId}/messages`, "POST", { clientMessageId: stickerClientId, stickerId: sticker.id, text: "" }, one);
  assert.equal((await stickerReplay.json()).id, stickerMessageId);
  const stickerForwarded = await call(`chats/${group}/messages`, "POST", { clientMessageId: v7(), forwardId: stickerMessageId, text: "" }, one);
  assert.equal(stickerForwarded.status, 200);
  assert.equal((await http(new Request(`${base}/media/${sticker.fileId}`, { headers: { cookie: two } }))).status, 200);
  assert.equal((await http(new Request(`${base}/media/${sticker.fileId}`))).status, 404);
  assert.equal((await stickerRequest(`/${packId}`, "PATCH", { active: true })).status, 200);
  assert.equal((await stickerRequest(`/${packId}`, "PATCH", { name: "Forbidden" }, one)).status, 403);
  assert.equal((await stickerRequest(`/${packId}`, "PATCH", { name: "  " })).status, 400);
  assert.equal((await stickerRequest(`/${packId}`, "PATCH", { name: "  Новое название  " })).status, 200);
  const renamedPack = (await (await stickerRequest("", "GET", undefined, one)).json()).find((p: { id: string; name: string; stickers: unknown[] }) => p.id === packId);
  assert.equal(renamedPack.name, "Новое название");
  assert.equal(renamedPack.stickers.length, 2);
  const metadataPath = `/${packId}/stickers/${sticker.id}`;
  const metadataEdit = { label: "Машущий кот", emojis: ["👋", "👨‍👩‍👧‍👦", "❤️", "❤"], keywords: [" Привет ", "ПРИВЕТ", "здравствуй"] };
  const beforeMetadata = await stickerRequest("", "GET", undefined, one);
  const oldEtag = beforeMetadata.headers.get("etag")!;
  assert.ok(oldEtag);
  assert.equal((await http(new Request(`${base}/api/stickers`, { headers: { cookie: one, "if-none-match": oldEtag } }))).status, 304);
  assert.equal((await stickerRequest(metadataPath, "PATCH", metadataEdit, one)).status, 403);
  assert.equal((await stickerRequest(metadataPath, "PATCH", { ...metadataEdit, emojis: ["not emoji"] })).status, 400);
  assert.equal((await stickerRequest(metadataPath, "PATCH", { ...metadataEdit, keywords: Array(33).fill("word") })).status, 400);
  assert.equal((await stickerRequest(metadataPath, "PATCH", metadataEdit)).status, 200);
  const updatedCatalog = await http(new Request(`${base}/api/stickers`, { headers: { cookie: one, "if-none-match": oldEtag } }));
  assert.equal(updatedCatalog.status, 200);
  assert.notEqual(updatedCatalog.headers.get("etag"), oldEtag);
  const updatedSticker = (await updatedCatalog.json()).find((p: { id: string; stickers: { id: string; label: string; emojis: string[]; keywords: string[] }[] }) => p.id === packId).stickers.find((s: { id: string }) => s.id === sticker.id);
  assert.equal(updatedSticker.label, "Машущий кот");
  assert.deepEqual(updatedSticker.emojis, ["👋", "👨‍👩‍👧‍👦", "❤️"]);
  assert.deepEqual(updatedSticker.keywords, ["привет", "здравствуй"]);
  const oldContent = (await db.execute(sql`select content from message where id=${stickerMessageId}`)).rows[0].content as { text: string };
  assert.equal(oldContent.text, sticker.label, "metadata edits must not rewrite historical messages");
  const deletePath = `/${packId}/stickers/${sticker.id}`;
  assert.equal((await stickerRequest(deletePath, "DELETE", undefined, one)).status, 403);
  assert.equal((await stickerRequest(`/${v7()}/stickers/${sticker.id}`, "DELETE")).status, 404);
  assert.equal((await stickerRequest(deletePath, "DELETE")).status, 200);
  assert.equal((await stickerRequest(deletePath, "DELETE")).status, 404);
  for (const session of [cookie, one]) {
    const remaining = (await (await stickerRequest("", "GET", undefined, session)).json()).find((p: { id: string; stickers: { id: string }[] }) => p.id === packId);
    assert.equal(remaining.stickers.length, 1);
    assert.equal(remaining.stickers.some((s: { id: string }) => s.id === sticker.id), false);
  }
  assert.equal((await call(`chats/${chatId}/messages`, "POST", { clientMessageId: v7(), stickerId: sticker.id, text: "" }, one)).status, 400);
  assert.equal((await http(new Request(`${base}/media/${sticker.fileId}`, { headers: { cookie: two } }))).status, 200);
  const afterDeleteForward = await call(`chats/${group}/messages`, "POST", { clientMessageId: v7(), forwardId: stickerMessageId, text: "" }, one);
  assert.equal(afterDeleteForward.status, 200);
  assert.equal((await http(new Request(`${base}/media/${sticker.fileId}`))).status, 404);
  const replayDeleted = await call(`chats/${chatId}/messages`, "POST", { clientMessageId: stickerClientId, stickerId: sticker.id, text: "" }, one);
  assert.equal((await replayDeleted.json()).id, stickerMessageId);
  for (const kind of ["audio", "circle"] as const) {
    const bytes = await recordingFixture(kind);
    const clientId = v7();
    async function uploadRecording(session: string, payload = bytes) {
      const form = new FormData(); form.set("chatId", chatId); form.set("kind", kind); form.set("clientMessageId", clientId); form.set("file", new File([payload], "recording.webm"));
      return http(new Request(`${base}/api/recordings`, { method: "POST", headers: { origin: base, cookie: session }, body: form }));
    }
    assert.equal((await uploadRecording(cookie)).status, 403);
    assert.equal((await uploadRecording(one, Buffer.from("invalid"))).status, 400);
    const uploaded = await uploadRecording(one);
    assert.equal(uploaded.status, 200, await uploaded.clone().text());
    const recordingId = (await uploaded.json()).id;
    assert.equal((await (await uploadRecording(one)).json()).id, recordingId);
    const recordingHistory = await (await call(`chats/${chatId}/messages`, "GET", undefined, two)).json();
    const message = recordingHistory.messages.find((m: { id: string; type: string; content: { fileId: string; duration: number } }) => m.id === recordingId);
    assert.equal(message.type, kind); assert.ok(message.content.duration > 0);
    const mediaUrl = `${base}/media/${message.content.fileId}`;
    assert.equal((await http(new Request(mediaUrl, { headers: { cookie } }))).status, 404);
    const range = await http(new Request(mediaUrl, { headers: { cookie: two, range: "bytes=0-31" } }));
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 32);
    assert.match(range.headers.get("content-range")!, /^bytes 0-31\//);
    assert.equal(range.headers.get("content-type"), kind === "audio" ? "audio/mp4" : "video/mp4");
    assert.equal((await http(new Request(mediaUrl, { headers: { cookie: two, range: "bytes=999999999-" } }))).status, 416);
    assert.equal((await call(`messages/${recordingId}`, "PATCH", { text: "forged" }, one)).status, 400);
    assert.equal((await call(`messages/${recordingId}/reaction`, "PATCH", { emoji: "❤️" }, two)).status, 200);
    const forwarded = await call(`chats/${group}/messages`, "POST", { clientMessageId: v7(), text: "", forwardId: recordingId }, one);
    assert.equal(forwarded.status, 200);
    assert.equal((await call("chats", "GET", undefined, one)).status, 200);
  }
  await pushScenarios(ids,[cookie,one,two],chatId,group,call);
  const block = await call(
    `admin/users/${ids[2]}`,
    "PATCH",
    {
      firstName: "Test",
      lastName: "2",
      email: emails[2],
      role: "user",
      banned: true,
    },
    cookie,
  );
  assert.equal(block.status, 200, await block.clone().text());
  assert.equal((await call("me", "GET", undefined, two)).status, 401);
  assert.equal((await db.execute(sql`select id from push_subscription where user_id=${ids[2]}`)).rowCount,0);
  const last = await call(
    `admin/users/${ids[0]}`,
    "PATCH",
    {
      firstName: "Test",
      lastName: "0",
      email: emails[0],
      role: "user",
      banned: false,
    },
    cookie,
  );
  assert.equal(last.status, 409);
});
