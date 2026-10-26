import { actor, checkOrigin, HttpError } from "@api/lib/http";
import { member, send } from "@api/modules/chat/service";
import { imageMime, storage } from "@api/modules/media/storage";
import { v7 } from "uuid";
import { z } from "zod";

export async function POST(request: Request) {
  let saved: string[] = [];
  try {
    checkOrigin(request);
    const u = await actor(request.headers);
    const form = await request.formData();
    const chatId = z.uuid().parse(form.get("chatId"));
    await member(chatId, u);
    const files = form.getAll("file");
    if (!files.length || files.length > 10)
      throw new HttpError(400, "Можно отправить от 1 до 10 фотографий");
    const photos: { id: string; mime: string; size: number }[] = [];
    const input = z.object({ clientMessageId: z.uuid(), text: z.string().max(10000), replyToId: z.uuid().optional() }).parse({
      clientMessageId: form.get("clientMessageId"), text: form.get("text") ?? "",
      replyToId: form.get("replyToId") ?? undefined,
    });
    for (const file of files) {
      if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024)
        throw new HttpError(400, "Выберите PNG, JPEG или WebP до 5 МБ каждый");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = imageMime(bytes);
      if (!mime) throw new HttpError(400, "Поддерживаются PNG, JPEG и WebP");
      const id = v7();
      await storage.save(id, bytes);
      saved.push(id);
      photos.push({ id, mime, size: bytes.length });
    }
    const result = await send(u, chatId, { ...input, photos });
    // The transaction owns the files after commit; a replay owns none of the new files.
    const uploaded = saved;
    saved = [];
    if (!("photoIds" in result))
      await Promise.all(uploaded.map(id => storage.remove(id).catch(() => {})));
    return Response.json(result);
  } catch (e) {
    await Promise.all(saved.map(id => storage.remove(id).catch(() => {})));
    return Response.json({ error: e instanceof HttpError ? e.message : e instanceof z.ZodError ? "Проверьте данные" : "Не удалось отправить фото" },
      { status: e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 500 });
  }
}
