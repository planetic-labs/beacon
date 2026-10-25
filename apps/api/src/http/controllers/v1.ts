import { sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { db } from "@api/db";
import { actor, adminOnly, checkOrigin, HttpError } from "@api/lib/http";
import {
  rows,
  member,
  writable,
  event,
  createChat,
  chatList,
  history,
  send,
} from "@api/modules/chat/service";
import { emojiSchema, messageTypes } from "@api/modules/chat/types";
const uuid = z.uuid();
const names = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
});
async function handler(
  request: Request,
  p: string[],
) {
  try {
    checkOrigin(request);
    const u = await actor(request.headers);
    const method = request.method;
    const data = method === "GET" ? {} : await request.json();
    const ok = (value: unknown) =>
      Response.json(value, { headers: { "Cache-Control": "no-store" } });
    if (p[0] === "me") {
      if (method === "GET")
        return ok({
          ...u,
          groups: await rows(
            sql`select g.id,g.name,g.code from membership_group g join group_member gm on gm.group_id=g.id where gm.user_id=${u.id} order by g.name`,
          ),
        });
      if (method === "PATCH") {
        const n = names.parse(data);
        await db.transaction(async (tx) => {
          await writable(tx, u);
          await tx.execute(
            sql`update "user" set first_name=${n.firstName},last_name=${n.lastName},name=${n.firstName + " " + n.lastName},updated_at=now() where id=${u.id}`,
          );
        });
        return ok({ ok: true });
      }
    }
    if (!u.firstName || !u.lastName)
      throw new HttpError(409, "Заполните имя и фамилию");
    if (p[0] === "users" && method === "GET")
      return ok(
        await rows(
          sql`select id,first_name as "firstName",last_name as "lastName",name,image,banned${u.role === "admin" ? sql`,email,role` : sql``} from "user" order by name,id`,
        ),
      );
    if (p[0] === "chats" && p.length === 1) {
      if (method === "GET") return ok(await chatList(u));
      if (method === "POST") {
        const input = z
          .object({
            kind: z.enum(["direct", "group"]),
            userIds: z.array(uuid).min(1).max(200),
            title: z.string().trim().min(1).max(120).optional(),
          })
          .parse(data);
        if (input.kind === "group" && !input.title)
          throw new HttpError(400, "Укажите название");
        return ok(await createChat(u, input));
      }
    }
    if (p[0] === "chats" && p[1]) {
      const chatId = uuid.parse(p[1]);
      if (p[2] === "messages") {
        if (method === "GET") {
          const q = new URL(request.url).searchParams;
          const after = q.has("afterId");
          const prefix = after ? "after" : "before";
          const cursor = q.has(`${prefix}Id`)
            ? {
                id: uuid.parse(q.get(`${prefix}Id`)),
                at: z.iso
                  .datetime({ offset: true })
                  .parse(q.get(`${prefix}At`)),
              }
            : undefined;
          return ok(
            await history(
              chatId,
              u,
              cursor,
              after,
              q.get("inclusive") === "true",
            ),
          );
        }
        if (method === "POST") {
          const input = z
            .object({
              clientMessageId: uuid,
              text: z.string().max(10000),
              replyToId: uuid.optional(),
              forwardId: uuid.optional(),
            })
            .parse(data);
          return ok(await send(u, chatId, input));
        }
      }
      if (p[2] === "read" && method === "POST") {
        const input = z.object({ messageId: uuid }).parse(data);
        await db.transaction(async (tx) => {
          await writable(tx, u);
          await member(chatId, u, tx, true);
          await tx.execute(
            sql`update chat_member set last_read_at=greatest(last_read_at,(select created_at from message where id=${input.messageId} and chat_id=${chatId})) where chat_id=${chatId} and user_id=${u.id}`,
          );
        });
        return ok({ ok: true });
      }
      if (p[2] === "members" && method === "GET") {
        const [c] = await rows(sql`select * from chat where id=${chatId}`);
        if (!c) throw new HttpError(404, "Чат не найден");
        if (u.role !== "admin") await member(chatId, u);
        return ok({
          chat: c,
          members: await rows(
            sql`select u.id,u.name,u.image,u.banned from "user" u join chat_member m on m.user_id=u.id where m.chat_id=${chatId} order by u.name`,
          ),
        });
      }
      if (method === "PATCH" && p.length === 2) {
        const input = z
          .object({
            title: z.string().trim().min(1).max(120).optional(),
            add: uuid.optional(),
            remove: uuid.optional(),
            ownerId: uuid.optional(),
            leave: z.boolean().optional(),
          })
          .parse(data);
        await db.transaction(async (tx) => {
          const fresh = await writable(tx, u);
          const [c] = await rows(
            sql`select * from chat where id=${chatId} for update`,
            tx,
          );
          if (!c || c.kind !== "group")
            throw new HttpError(400, "Нужен групповой чат");
          const previous = (
            await rows(
              sql`select user_id from chat_member where chat_id=${chatId}`,
              tx,
            )
          ).map((m) => m.user_id);
          if (input.leave) {
            if (!previous.includes(u.id))
              throw new HttpError(403, "Нет доступа");
            if (c.owner_id === u.id)
              throw new HttpError(409, "Передайте управление перед выходом");
            await tx.execute(
              sql`delete from chat_member where chat_id=${chatId} and user_id=${u.id}`,
            );
          } else {
            if (c.owner_id !== u.id && fresh.role !== "admin")
              throw new HttpError(403, "Недостаточно прав");
            if (input.title)
              await tx.execute(
                sql`update chat set title=${input.title} where id=${chatId}`,
              );
            if (input.add) {
              const [active] = await rows(
                sql`select id from "user" where id=${input.add} and not banned`,
                tx,
              );
              if (!active) throw new HttpError(400, "Пользователь недоступен");
              await tx.execute(
                sql`insert into chat_member(chat_id,user_id) values(${chatId},${input.add}) on conflict do nothing`,
              );
            }
            if (input.ownerId) {
              const [owner] = await rows(
                sql`select u.id from "user" u join chat_member m on m.user_id=u.id where m.chat_id=${chatId} and u.id=${input.ownerId} and not u.banned`,
                tx,
              );
              if (!owner)
                throw new HttpError(400, "Выберите активного участника");
              await tx.execute(
                sql`update chat set owner_id=${input.ownerId} where id=${chatId}`,
              );
            }
            if (input.remove) {
              if (input.remove === (input.ownerId ?? c.owner_id))
                throw new HttpError(409, "Нельзя исключить владельца");
              await tx.execute(
                sql`delete from chat_member where chat_id=${chatId} and user_id=${input.remove}`,
              );
            }
          }
          const next = (
            await rows(
              sql`select user_id from chat_member where chat_id=${chatId}`,
              tx,
            )
          ).map((m) => m.user_id);
          await event(tx, chatId, [...new Set([...previous, ...next])]);
        });
        return ok({ ok: true });
      }
    }
    if (p[0] === "messages" && p[1] && method === "PATCH") {
      const id = uuid.parse(p[1]);
      await db.transaction(async (tx) => {
        await writable(tx, u);
        const [m] = await rows(sql`select * from message where id=${id}`, tx);
        if (!m) throw new HttpError(404, "Сообщение не найдено");
        await member(m.chat_id, u, tx, true);
        if (p[2] === "reaction") {
          const { emoji } = z.object({ emoji: emojiSchema }).parse(data);
          await tx.execute(
            sql`insert into reaction(message_id,user_id,emoji) values(${id},${u.id},${emoji}) on conflict(message_id,user_id) do update set emoji=excluded.emoji`,
          );
          if (data.remove === true)
            await tx.execute(
              sql`delete from reaction where message_id=${id} and user_id=${u.id}`,
            );
        } else {
          if (m.author_id !== u.id)
            throw new HttpError(403, "Можно менять только свои сообщения");
          const content = messageTypes.text.validate.parse(data);
          await tx.execute(
            sql`update message set content=${JSON.stringify(content)}::jsonb,edited_at=now() where id=${id}`,
          );
        }
        await event(tx, m.chat_id);
      });
      return ok({ ok: true });
    }
    if (p[0] === "admin") {
      adminOnly(u);
      if (p[1] === "chats" && method === "GET")
        return ok(
          await rows(
            sql`select id,title,owner_id as "ownerId" from chat where kind='group' order by title`,
          ),
        );
      if (p[1] === "users" && method === "POST") {
        const input = names
          .extend({
            email: z.email().transform((e) => e.toLowerCase()),
            role: z.enum(["user", "admin"]),
          })
          .parse(data);
        const result = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(917340)`);
          await writable(tx, u);
          const [admin] = await rows(
            sql`select role from "user" where id=${u.id}`,
            tx,
          );
          if (admin.role !== "admin")
            throw new HttpError(403, "Недостаточно прав");
          return rows(
            sql`insert into "user"(first_name,last_name,name,email,role) values(${input.firstName},${input.lastName},${input.firstName + " " + input.lastName},${input.email},${input.role}) returning id`,
            tx,
          );
        });
        return ok(result[0]);
      }
      if (p[1] === "users" && p[2] && method === "PATCH") {
        const id = uuid.parse(p[2]),
          input = names
            .extend({
              email: z.email().transform((e) => e.toLowerCase()),
              role: z.enum(["user", "admin"]),
              banned: z.boolean(),
            })
            .parse(data);
        await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(917340)`);
          await writable(tx, u);
          const [admin] = await rows(
            sql`select role from "user" where id=${u.id}`,
            tx,
          );
          if (admin.role !== "admin")
            throw new HttpError(403, "Недостаточно прав");
          const [target] = await rows(
            sql`select * from "user" where id=${id} for update`,
            tx,
          );
          if (!target) throw new HttpError(404, "Пользователь не найден");
          if (
            target.role === "admin" &&
            !target.banned &&
            (input.banned || input.role !== "admin")
          ) {
            const [c] = await rows(
              sql`select count(*)::int as count from "user" where role='admin' and not banned`,
              tx,
            );
            if (c.count <= 1)
              throw new HttpError(
                409,
                "Нельзя лишить доступа последнего администратора",
              );
          }
          await tx.execute(
            sql`update "user" set first_name=${input.firstName},last_name=${input.lastName},name=${input.firstName + " " + input.lastName},email=${input.email},role=${input.role},banned=${input.banned},email_verified=case when email=${input.email} then email_verified else false end,updated_at=now() where id=${id}`,
          );
          if (
            input.banned ||
            target.email !== input.email ||
            target.role !== input.role
          ) {
            await tx.execute(sql`delete from session where user_id=${id}`);
            await tx.execute(
              sql`update oauth_refresh_token set revoked=now() where user_id=${id}`,
            );
            await tx.execute(
              sql`update oauth_access_token set revoked=now() where user_id=${id}`,
            );
            await tx.execute(
              sql`insert into outbox(kind,payload) values('user.revoked',${JSON.stringify({ blockedUserId: id })}::jsonb)`,
            );
          }
        });
        return ok({ ok: true });
      }
      if (p[1] === "groups") {
        if (method === "GET")
          return ok(
            await rows(
              sql`select g.*,coalesce((select json_agg(user_id) from group_member gm where gm.group_id=g.id),'[]'::json) as members from membership_group g order by name`,
            ),
          );
        await db.transaction(async (tx) => {
          await writable(tx, u);
          const [a] = await rows(
            sql`select role from "user" where id=${u.id}`,
            tx,
          );
          if (a.role !== "admin") throw new HttpError(403, "Недостаточно прав");
          if (method === "POST") {
            const input = z
              .object({
                name: z.string().trim().min(1).max(100),
                code: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
              })
              .parse(data);
            await tx.execute(
              sql`insert into membership_group(name,code) values(${input.name},${input.code})`,
            );
          } else if (method === "PATCH" && p[2]) {
            const id = uuid.parse(p[2]);
            const input = z
              .object({
                name: z.string().trim().min(1).max(100),
                userIds: z.array(uuid).max(1000),
              })
              .parse(data);
            await tx.execute(
              sql`select id from membership_group where id=${id} for update`,
            );
            await tx.execute(
              sql`update membership_group set name=${input.name} where id=${id}`,
            );
            await tx.execute(
              sql`delete from group_member where group_id=${id}`,
            );
            for (const uid of new Set(input.userIds))
              await tx.execute(
                sql`insert into group_member(group_id,user_id) values(${id},${uid})`,
              );
          } else throw new HttpError(405, "Действие недоступно");
        });
        return ok({ ok: true });
      }
    }
    throw new HttpError(404, "Не найдено");
  } catch (e) {
    if (e instanceof HttpError)
      return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof ZodError)
      return Response.json(
        { error: "Проверьте введённые данные" },
        { status: 400 },
      );
    if (
      (e as { code?: string }).code === "23505" ||
      (e as { cause?: { code?: string } }).cause?.code === "23505"
    )
      return Response.json(
        { error: "Такая запись уже существует" },
        { status: 409 },
      );
    console.error("ERROR request failed", {
      path: new URL(request.url).pathname,
      type: e instanceof Error ? e.name : "unknown",
    });
    return Response.json(
      { error: "Не удалось выполнить запрос" },
      { status: 500 },
    );
  }
}
export { handler as GET, handler as POST, handler as PATCH };
