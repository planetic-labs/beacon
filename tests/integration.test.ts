import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import { auth } from "../src/modules/auth/config";
import { db, pool } from "../src/db";
import { GET, POST, PATCH } from "../src/app/api/v1/[...path]/route";
import { POST as authPost } from "../src/app/api/auth/[...all]/route";
import { GET as metadata } from "../src/app/.well-known/openid-configuration/route";
import { POST as uploadAvatar } from "../src/app/api/avatar/route";
import { GET as readMedia } from "../src/app/media/[id]/route";
import { getAuthTables } from "better-auth/db";
import * as schema from "../src/db/schema";
import { getTableColumns } from "drizzle-orm";
import { pushScenarios } from "./push-scenarios";

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
  return auth.handler(
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
  return ({ GET, POST, PATCH } as Record<string, typeof GET>)[method](req, {
    params: Promise.resolve({ path: path.split("?")[0].split("/") }),
  });
}
after(async () => {
  globalThis.fetch = realFetch;
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
  const cookie = await login(emails[0]),
    one = await login(emails[1]),
    two = await login(emails[2]);
  assert.equal((await call("me", "GET", undefined, cookie)).status, 200);
  const people = await (await call("users", "GET", undefined, one)).json();
  assert.ok(people.every((p: any) => !("email" in p) && !("role" in p)));
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
  const authorize = await auth.handler(
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
  const token = await auth.handler(
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
  const info = await auth.handler(
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
  const needsLogin = await auth.handler(new Request(`${discovery.authorization_endpoint}?${freshQuery}`, {
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
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
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
