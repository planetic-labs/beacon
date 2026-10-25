import { sql } from "drizzle-orm";
import { writeFile } from "node:fs/promises";
import { makeSignature } from "better-auth/crypto";
import { db, pool } from "../src/db";
import { auth } from "../src/modules/auth/config";
import { createChat, send } from "../src/modules/chat/service";
import { v7 } from "uuid";
if (process.env.APP_ENV !== "test")
  throw new Error("Disposable test environment required");
const ctx = await auth.$context;
const users = [];
try {
  for (let i = 0; i < 2; i++) {
    const id = v7();
    const firstName = i === 0 ? "Алексей" : "Марина",
      lastName = i === 0 ? "Тестовый" : "Тестовая";
    await db.execute(
      sql`insert into "user"(id,name,first_name,last_name,email,email_verified,role) values(${id},${firstName + " " + lastName},${firstName},${lastName},${`browser-${id}@example.com`},true,${i === 0 ? "admin" : "user"})`,
    );
    const session = await ctx.internalAdapter.createSession(id);
    if (!session) throw new Error("Session creation failed");
    const value = encodeURIComponent(
      `${session.token}.${await makeSignature(session.token, process.env.BETTER_AUTH_SECRET!)}`,
    );
    users.push({
      id,
      firstName,
      lastName,
      cookieName: ctx.authCookies.sessionToken.name,
      cookieValue: value,
    });
  }
  const chat = await createChat(
    { id: users[0].id, role: "admin" },
    {
      kind: "group",
      title: "Чат для технических моментов",
      userIds: [users[1].id],
    },
  );
  await send({ id: users[1].id, role: "user" }, chat.id, {
    clientMessageId: v7(),
    text: "Добро пожаловать. Напишите, когда откроется чат.",
  });
  await send({ id: users[0].id, role: "admin" }, chat.id, {
    clientMessageId: v7(),
    text: "Чат открылся, всё вижу.",
  });
  await writeFile(
    "/run/test/browser.json",
    JSON.stringify({ users, chatId: chat.id }),
    { mode: 0o600 },
  );
  console.log("INFO browser fixtures ready");
} finally {
  await pool.end();
}
