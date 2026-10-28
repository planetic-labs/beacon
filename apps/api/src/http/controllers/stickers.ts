import { createHash } from "node:crypto";
import { stickerMetadataSchema } from "@beacon/shared";
import { actor, adminOnly, checkOrigin, HttpError } from "@api/lib/http";
import { db } from "@api/db";
import { rows, writable, type Actor, type Tx } from "@api/modules/chat/service";
import { storage } from "@api/modules/media/storage";
import { sql } from "drizzle-orm";
import { prepareSticker, MAX_STICKER_SOURCE_BYTES } from "@api/modules/stickers/image";
import { v7 } from "uuid";
import { z } from "zod";
const packName = z.string().trim().min(1).max(80);

async function editablePack(tx: Tx, user: Actor, packId: string) {
  const fresh = await writable(tx, user);
  const [pack] = await rows(sql`select id,owner_id from sticker_pack where id=${packId} and deleted_at is null for update`, tx);
  if (!pack) throw new HttpError(404, "Набор не найден");
  if (fresh.role !== "admin" && pack.owner_id !== fresh.id)
    throw new HttpError(403, "Можно управлять только своими наборами");
}
async function cleanup(tx: Tx, fileIds: string[]) {
  if (fileIds.length) await tx.execute(sql`insert into outbox(kind,payload) values('media.cleanup',${JSON.stringify({fileIds})}::jsonb)`);
}
export async function handler(request: Request) {
  let saved: string[] = [];
  try {
    checkOrigin(request);
    const u = await actor(request.headers);
    const url = new URL(request.url);
    const [, , , part, resource, stickerPart, extra] = url.pathname.split("/");
    const packId = part ? z.uuid().parse(part) : undefined;
    if (extra || resource && (resource !== "stickers" || !stickerPart)) throw new HttpError(404, "Действие не найдено");
    const stickerId = stickerPart ? z.uuid().parse(stickerPart) : undefined;
    if (request.method === "GET" && !packId) {
      const scope = z.enum(["catalog","mine","all"]).parse(url.searchParams.get("scope") ?? "catalog");
      if (scope === "all") adminOnly(u);
      const filter = scope === "mine" ? sql`p.owner_id=${u.id}` : scope === "all" ? sql`true` : sql`p.active`;
      const packs = await rows(sql`select p.id,p.name,p.active,p.owner_id as "ownerId",u.name as "ownerName",
        coalesce((select json_agg(json_build_object('id',s.id,'fileId',s.file_id,'label',s.label,'emojis',s.emojis,'keywords',s.keywords) order by s.created_at,s.id) from sticker s where s.pack_id=p.id),'[]'::json) as stickers
        from sticker_pack p left join "user" u on u.id=p.owner_id where p.deleted_at is null and ${filter} order by p.created_at,p.id`);
      const body = JSON.stringify(packs);
      const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
      const headers = { "Cache-Control":"private, no-cache", Vary:"Cookie", ETag:etag };
      if (request.headers.get("if-none-match") === etag) return new Response(null, { status:304, headers });
      return new Response(body, {headers:{...headers,"Content-Type":"application/json"}});
    }
    if (request.method === "DELETE" && packId) {
      await db.transaction(async tx => {
        await editablePack(tx,u,packId);
        if (stickerId) {
          const deleted = await rows(sql`delete from sticker where id=${stickerId} and pack_id=${packId} returning file_id`,tx);
          if (!deleted.length) throw new HttpError(404,"Стикер не найден в этом наборе");
          await cleanup(tx,deleted.map(row=>row.file_id));
        } else {
          const deleted = await rows(sql`delete from sticker where pack_id=${packId} returning file_id`,tx);
          await tx.execute(sql`update sticker_pack set active=false,deleted_at=now() where id=${packId}`);
          await cleanup(tx,deleted.map(row=>row.file_id));
        }
      });
      return Response.json({ok:true});
    }
    if (request.method === "PATCH" && packId) {
      const data = stickerId ? stickerMetadataSchema.parse(await request.json())
        : z.object({name:packName.optional(),active:z.boolean().optional()}).parse(await request.json());
      await db.transaction(async tx => {
        await editablePack(tx,u,packId);
        if (stickerId && "label" in data) {
          const changed = await rows(sql`update sticker set label=${data.label},emojis=ARRAY(select jsonb_array_elements_text(${JSON.stringify(data.emojis)}::jsonb)),keywords=ARRAY(select jsonb_array_elements_text(${JSON.stringify(data.keywords)}::jsonb)) where id=${stickerId} and pack_id=${packId} returning id`,tx);
          if (!changed.length) throw new HttpError(404,"Стикер не найден в этом наборе");
        } else if (!stickerId && !("label" in data)) {
          if (data.name !== undefined) await tx.execute(sql`update sticker_pack set name=${data.name} where id=${packId}`);
          if (data.active !== undefined) await tx.execute(sql`update sticker_pack set active=${data.active} where id=${packId}`);
        }
      });
      return Response.json({ok:true});
    }
    if (request.method !== "POST" || resource) throw new HttpError(405,"Действие недоступно");
    if (!packId) {
      const {name} = z.object({name:packName}).parse(await request.json());
      const id = v7();
      await db.transaction(async tx => {
        await writable(tx,u);
        await tx.execute(sql`insert into sticker_pack(id,name,owner_id) values(${id},${name},${u.id})`);
      });
      return Response.json({id});
    }
    // Check permissions before expensive processing and again when committing.
    await db.transaction(tx=>editablePack(tx,u,packId));
    const form = await request.formData();
    const files = form.getAll("file");
    if (!files.length || files.length > 10) throw new HttpError(400,"Выберите от 1 до 10 стикеров");
    const uploaded: {id:string;fileId:string;label:string;mime:string;size:number}[]=[];
    for (const file of files) {
      if (!(file instanceof File) || !file.size || file.size > MAX_STICKER_SOURCE_BYTES)
        throw new HttpError(400,"Исходное изображение должно быть PNG, JPEG или WebP до 10 МБ");
      const bytes = await prepareSticker(new Uint8Array(await file.arrayBuffer()));
      const fileId = v7();
      await storage.save(fileId,bytes); saved.push(fileId);
      uploaded.push({id:v7(),fileId,label:file.name.replace(/\.[^.]+$/,"").trim().slice(0,80)||"Стикер",mime:"image/webp",size:bytes.length});
    }
    await db.transaction(async tx=>{
      await editablePack(tx,u,packId);
      for (const item of uploaded) {
        await tx.execute(sql`insert into media_file(id,owner_id,storage_key,mime,size) values(${item.fileId},${u.id},${item.fileId},${item.mime},${item.size})`);
        await tx.execute(sql`insert into sticker(id,pack_id,file_id,label) values(${item.id},${packId},${item.fileId},${item.label})`);
      }
    });
    saved=[];
    return Response.json({ok:true});
  } catch(e) {
    await Promise.all(saved.map(id=>storage.remove(id).catch(()=>{})));
    return Response.json({error:e instanceof HttpError?e.message:e instanceof z.ZodError?"Проверьте данные":"Не удалось сохранить стикеры"},
      {status:e instanceof HttpError?e.status:e instanceof z.ZodError?400:500});
  }
}
