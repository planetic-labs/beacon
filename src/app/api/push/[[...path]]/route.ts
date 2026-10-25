import { sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { db } from "@/db";
import { auth } from "@/modules/auth/config";
import { actor, checkOrigin, HttpError } from "@/lib/http";
import { writable } from "@/modules/chat/service";
import { settings, subscribe, mute, notification, visibleNotification } from "@/modules/push/service";
export const runtime = "nodejs";
async function handler(request: Request, context: {params: Promise<{path?: string[]}>}) {
  try {
    checkOrigin(request);
    const u = await actor(request.headers);
    const s = await auth.api.getSession({ headers: request.headers });
    if (!s) throw new HttpError(401,"Войдите в приложение");
    const {path=[]} = await context.params;
    const ok = (data: unknown) => Response.json(data, {headers: {"Cache-Control":"no-store"}});
    if (request.method === "GET") {
      if (!path.length) return ok(await settings(u.id));
      if (path[0] === "notification" && path.length === 1) {
        const q = new URL(request.url).searchParams;
        const messageId = z.uuid().parse(q.get("messageId"));
        const subscriptionId = z.uuid().parse(q.get("subscriptionId"));
        const row = await notification(subscriptionId,messageId,u.id,s.session.id);
        return ok(row ? visibleNotification(row) : null);
      }
    } else {
      const text = await request.text();
      if (text.length > 16384) throw new HttpError(413,"Слишком большой запрос");
      const data = JSON.parse(text || "{}");
      if (path[0] === "subscriptions" && path.length === 1) {
        if (request.method === "POST") return ok(await subscribe(u,s.session.id,data));
        if (request.method === "DELETE") {
          const {endpoint} = z.object({endpoint:z.string().max(4096)}).parse(data);
          await db.execute(sql`delete from push_subscription where user_id=${u.id} and endpoint=${endpoint}`);
          return ok({ok:true});
        }
      }
      if (!path.length && request.method === "PATCH") {
        const input = z.object({enabled:z.boolean(),showPreview:z.boolean()}).parse(data);
        await db.transaction(async tx => {
          await writable(tx,u);
          await tx.execute(sql`insert into notification_preference(user_id,enabled,show_preview)
            values(${u.id},${input.enabled},${input.showPreview}) on conflict(user_id)
            do update set enabled=excluded.enabled,show_preview=excluded.show_preview`);
        });
        return ok(await settings(u.id));
      }
      if (path[0] === "chats" && path.length === 2 && request.method === "PATCH") {
        const {muted} = z.object({muted:z.boolean()}).parse(data);
        await mute(u,z.uuid().parse(path[1]),muted);
        return ok({ok:true});
      }
    }
    throw new HttpError(404,"Не найдено");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
    return Response.json({error: error instanceof HttpError ? error.message : status === 400 ? "Некорректные данные подписки" : "Не удалось настроить уведомления"},
      {status,headers:{"Cache-Control":"no-store"}});
  }
}
export {handler as GET, handler as POST, handler as PATCH, handler as DELETE};
