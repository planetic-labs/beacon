import { actor, checkOrigin, HttpError } from "@/lib/http";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import { storage, imageMime } from "@/modules/media/storage";
import { writable } from "@/modules/chat/service";
import { rows, event } from "@/modules/chat/service";
import { z } from "zod";
export async function POST(request: Request) {
  let saved: string | undefined;
  try {
    checkOrigin(request);
    const u = await actor(request.headers);
    const form = await request.formData(),
      file = form.get("file");
    const targetUser = z.uuid().parse(form.get("userId") ?? u.id);
    const chatId = form.get("chatId")
      ? z.uuid().parse(form.get("chatId"))
      : null;
    if (!(file instanceof File) || file.size > 5 * 1024 * 1024)
      throw new HttpError(400, "Выберите PNG, JPEG или WebP до 5 МБ");
    const bytes = new Uint8Array(await file.arrayBuffer()),
      mime = imageMime(bytes);
    if (!mime) throw new HttpError(400, "Поддерживаются PNG, JPEG и WebP");
    const id = v7();
    await storage.save(id, bytes);
    saved = id;
    await db.transaction(async (tx) => {
      await writable(tx, u);
      const [fresh] = await rows(
        sql`select role from "user" where id=${u.id}`,
        tx,
      );
      if (!chatId && targetUser !== u.id && fresh.role !== "admin")
        throw new HttpError(403, "Недостаточно прав");
      if (chatId) {
        const [chat] = await rows(
          sql`select * from chat where id=${chatId} and kind='group' for update`,
          tx,
        );
        if (!chat || (chat.owner_id !== u.id && fresh.role !== "admin"))
          throw new HttpError(403, "Недостаточно прав");
      } else {
        const [target] = await rows(
          sql`select id from "user" where id=${targetUser}`,
          tx,
        );
        if (!target) throw new HttpError(404, "Пользователь не найден");
      }
      await tx.execute(
        sql`insert into media_file(id,owner_id,storage_key,mime,size) values(${id},${u.id},${id},${mime},${bytes.length})`,
      );
      if (chatId) {
        await tx.execute(
          sql`update chat set image=${"/media/" + id} where id=${chatId}`,
        );
        await event(tx, chatId);
      } else
        await tx.execute(
          sql`update "user" set image=${"/media/" + id},updated_at=now() where id=${targetUser}`,
        );
    });
    // The stable relative reference also works across private media delivery backends.
    return Response.json({ url: "/media/" + id });
  } catch (e) {
    if (saved) await storage.remove(saved).catch(() => {});
    return Response.json(
      {
        error:
          e instanceof HttpError
            ? e.message
            : e instanceof z.ZodError
              ? "Проверьте данные"
              : "Не удалось сохранить аватар",
      },
      {
        status:
          e instanceof HttpError
            ? e.status
            : e instanceof z.ZodError
              ? 400
              : 500,
      },
    );
  }
}
