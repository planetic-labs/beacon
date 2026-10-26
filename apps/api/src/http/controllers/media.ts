import { thumbnail } from "@api/modules/media/thumbnail";
import { Readable } from "node:stream";
import { actor } from "@api/lib/http";
import { rows } from "@api/modules/chat/service";
import { byteRange } from "@api/modules/media/range";
import { storage } from "@api/modules/media/storage";
import { sql } from "drizzle-orm";
import { z } from "zod";
export async function GET(
  request: Request,
  fileId: string,
) {
  try {
    const u = await actor(request.headers);
    const id = z.uuid().parse(fileId);
    // Chat attachments require current membership, including forwarded copies.
    const [file] = await rows(
      sql`select f.* from media_file f where f.id=${id} and (exists(select 1 from "user" u where u.image=${"/media/" + id}) or exists(select 1 from chat c join chat_member cm on cm.chat_id=c.id where c.image=${"/media/" + id} and cm.user_id=${u.id}) or exists(select 1 from sticker s where s.file_id=f.id) or exists(select 1 from message m join chat_member cm on cm.chat_id=m.chat_id where m.deleted_at is null and m.type in ('photo','sticker','audio','circle','file','video') and (m.content->>'fileId'=${id} or (m.content->'fileIds') ? ${id}) and cm.user_id=${u.id}))`,
    );
    if (!file) return new Response(null, { status: 404 });

    const headers: Record<string, string> = {
      "Content-Type": file.mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if(new URL(request.url).searchParams.get("thumbnail")==="1"){
      if(!["image/jpeg","image/png","image/webp"].includes(file.mime)||file.size>10*1024*1024)return new Response(null,{status:404});
      const preview=await thumbnail(id,file.storage_key);
      return new Response(new Uint8Array(preview),{headers:{"Content-Type":"image/webp","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
    }
    if (file.original_name || new URL(request.url).searchParams.has("download")) {
      // Untrusted formats are downloads, never same-origin executable documents.
      const disposition = !new URL(request.url).searchParams.has("download") && ["video/mp4","video/webm"].includes(file.mime) ? "inline" : "attachment";
      headers["Content-Disposition"] = `${disposition}; filename="download"; filename*=UTF-8''${encodeURIComponent(file.original_name??`photo-${id}.${file.mime==="image/png"?"png":file.mime==="image/webp"?"webp":file.mime==="image/jpeg"?"jpg":"bin"}`).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16)}`)}`;
    }
    let range;
    try { range = byteRange(request.headers.get("range"), file.size); }
    catch { return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.size}` } }); }
    if (range) {
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${file.size}`;
      headers["Content-Length"] = String(range.end - range.start + 1);
      const stream=await storage.readStream(file.storage_key,range.start,range.end);
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: 206, headers });
    }
    headers["Content-Length"] = String(file.size);
    const stream=await storage.readStream(file.storage_key);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers });
  } catch {
    return new Response(null, { status: 404 });
  }
}
