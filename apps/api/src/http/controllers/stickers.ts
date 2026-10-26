import { createHash } from "node:crypto";
import { stickerMetadataSchema } from "@beacon/shared";
import { actor, adminOnly, checkOrigin, HttpError } from "@api/lib/http";
import { db } from "@api/db";
import { rows, writable } from "@api/modules/chat/service";
import { storage } from "@api/modules/media/storage";
import { sql } from "drizzle-orm";
import { prepareSticker, MAX_STICKER_SOURCE_BYTES } from "@api/modules/stickers/image";
import { v7 } from "uuid";
import { z } from "zod";
const packName = z.string().trim().min(1).max(80);

export async function handler(request: Request) {
  let saved: string[] = [];
  try {
    checkOrigin(request);
    const u = await actor(request.headers);
    if (request.method === "GET") {
      const packs = await rows(sql`select p.id,p.name,p.active,
        coalesce((select json_agg(json_build_object('id',s.id,'fileId',s.file_id,'label',s.label,'emojis',s.emojis,'keywords',s.keywords) order by s.created_at,s.id) from sticker s where s.pack_id=p.id),'[]'::json) as stickers
        from sticker_pack p where p.active or ${u.role === "admin"} order by p.created_at,p.id`);
      const body = JSON.stringify(packs);
      const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
      if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
      return new Response(body, { headers: { "Content-Type": "application/json", ETag: etag } });
    }
    adminOnly(u);
    const part = new URL(request.url).pathname.split("/")[3];
    const packId = part ? z.uuid().parse(part) : undefined;
    if (request.method === "DELETE" && packId) {
      const stickerId = z.uuid().parse(new URL(request.url).pathname.split("/")[5]);
      await db.transaction(async tx => {
        const fresh = await writable(tx, u);
        adminOnly({ role: fresh.role });
        // Serialize with sends and pack changes. Historical messages keep their media reference.
        if (!(await rows(sql`select id from sticker_pack where id=${packId} for update`, tx)).length)
          throw new HttpError(404, "Набор не найден");
        const deleted = await rows(sql`delete from sticker where id=${stickerId} and pack_id=${packId} returning id`, tx);
        if (!deleted.length) throw new HttpError(404, "Стикер не найден в этом наборе");
      });
      return Response.json({ ok: true });
    }
    if (request.method === "PATCH" && packId && new URL(request.url).pathname.split("/")[4] === "stickers") {
      const stickerId = z.uuid().parse(new URL(request.url).pathname.split("/")[5]);
      const data = stickerMetadataSchema.parse(await request.json());
      await db.transaction(async tx => {
        const fresh = await writable(tx, u); adminOnly({ role: fresh.role });
        if (!(await rows(sql`select id from sticker_pack where id=${packId} for update`, tx)).length)
          throw new HttpError(404, "Набор не найден");
        // PostgreSQL arrays are decoded from JSON explicitly to avoid SQL parameter ambiguity.
        const changed = await rows(sql`update sticker set label=${data.label},emojis=ARRAY(select jsonb_array_elements_text(${JSON.stringify(data.emojis)}::jsonb)),keywords=ARRAY(select jsonb_array_elements_text(${JSON.stringify(data.keywords)}::jsonb)) where id=${stickerId} and pack_id=${packId} returning id`, tx);
        if (!changed.length) throw new HttpError(404, "Стикер не найден в этом наборе");
      });
      return Response.json({ ok: true });
    }
    if (request.method === "PATCH" && packId) {
      const data = z.object({ name: packName.optional(), active: z.boolean().optional() }).parse(await request.json());
      await db.transaction(async tx => {
        await writable(tx, u);
        const [fresh] = await rows(sql`select role from "user" where id=${u.id}`, tx);
        adminOnly({ role: fresh.role });
        const [pack] = await rows(sql`select id from sticker_pack where id=${packId} for update`, tx);
        if (!pack) throw new HttpError(404, "Набор не найден");
        if (data.name !== undefined) await tx.execute(sql`update sticker_pack set name=${data.name} where id=${packId}`);
        if (data.active !== undefined) await tx.execute(sql`update sticker_pack set active=${data.active} where id=${packId}`);
      });
      return Response.json({ ok: true });
    }
    if (request.method !== "POST") throw new HttpError(405, "Действие недоступно");
    if (!packId) {
      const { name } = z.object({ name: packName }).parse(await request.json());
      const id = v7();
      await db.transaction(async tx => {
        await writable(tx, u);
        adminOnly({ role: (await rows(sql`select role from "user" where id=${u.id}`, tx))[0].role });
        await tx.execute(sql`insert into sticker_pack(id,name) values(${id},${name})`);
      });
      return Response.json({ id });
    }
    const form = await request.formData();
    const files = form.getAll("file");
    if (!files.length || files.length > 10) throw new HttpError(400, "Выберите от 1 до 10 стикеров");
    const uploaded: { id: string; fileId: string; label: string; mime: string; size: number }[] = [];
    for (const file of files) {
      if (!(file instanceof File) || !file.size || file.size > MAX_STICKER_SOURCE_BYTES)
        throw new HttpError(400, "Исходное изображение должно быть PNG, JPEG или WebP до 10 МБ");
      const bytes = await prepareSticker(new Uint8Array(await file.arrayBuffer()));
      const mime = "image/webp";
      const fileId = v7();
      await storage.save(fileId, bytes); saved.push(fileId);
      uploaded.push({ id: v7(), fileId, label: file.name.replace(/\.[^.]+$/, "").trim().slice(0, 80) || "Стикер", mime, size: bytes.length });
    }
    await db.transaction(async tx => {
      await writable(tx, u);
      adminOnly({ role: (await rows(sql`select role from "user" where id=${u.id}`, tx))[0].role });
      if (!(await rows(sql`select id from sticker_pack where id=${packId} for update`, tx)).length)
        throw new HttpError(404, "Набор не найден");
      for (const item of uploaded) {
        await tx.execute(sql`insert into media_file(id,owner_id,storage_key,mime,size) values(${item.fileId},${u.id},${item.fileId},${item.mime},${item.size})`);
        await tx.execute(sql`insert into sticker(id,pack_id,file_id,label) values(${item.id},${packId},${item.fileId},${item.label})`);
      }
    });
    saved = [];
    return Response.json({ ok: true });
  } catch (e) {
    await Promise.all(saved.map(id => storage.remove(id).catch(() => {})));
    return Response.json({ error: e instanceof HttpError ? e.message : e instanceof z.ZodError ? "Проверьте данные" : "Не удалось сохранить стикеры" },
      { status: e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 500 });
  }
}
