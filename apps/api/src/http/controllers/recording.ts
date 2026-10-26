import { actor, checkOrigin, HttpError } from "@api/lib/http";
import { member, send, rows } from "@api/modules/chat/service";
import { storage } from "@api/modules/media/storage";
import { prepareRecording } from "@api/modules/media/recording";
import { recordingLimits } from "@beacon/shared";
import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import { z } from "zod";
export async function POST(request: Request) {
  let saved: string | undefined;
  try {
    checkOrigin(request);
    const u = await actor(request.headers);
    const form = await request.formData();
    const input = z.object({ chatId: z.uuid(), clientMessageId: z.uuid(), kind: z.enum(["audio", "circle"]), replyToId: z.uuid().optional() }).parse({
      chatId: form.get("chatId"), clientMessageId: form.get("clientMessageId"), kind: form.get("kind"), replyToId: form.get("replyToId") ?? undefined,
    });
    await member(input.chatId, u);
    const [old] = await rows(sql`select id,chat_id from message where author_id=${u.id} and client_message_id=${input.clientMessageId}`);
    if (old) {
      if (old.chat_id !== input.chatId) throw new HttpError(409, "Повторный идентификатор сообщения");
      return Response.json({ id: old.id });
    }
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > recordingLimits[input.kind].bytes) throw new HttpError(400, "Запись слишком большая или пустая");
    const processed = await prepareRecording(new Uint8Array(await file.arrayBuffer()), input.kind);
    const id = v7(); await storage.save(id, processed.bytes); saved = id;
    const result = await send(u, input.chatId, { clientMessageId: input.clientMessageId, replyToId: input.replyToId, text: "", recording: { id, kind: input.kind, mime: processed.mime, duration: processed.duration, size: processed.bytes.length } });
    saved = undefined;
    if (!("recordingId" in result)) await storage.remove(id).catch(() => {});
    return Response.json(result);
  } catch (error) {
    if (saved) await storage.remove(saved).catch(() => {});
    return Response.json({ error: error instanceof HttpError ? error.message : error instanceof z.ZodError ? "Проверьте данные записи" : "Не удалось отправить запись" }, { status: error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500 });
  }
}
