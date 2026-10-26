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
      sql`select f.* from media_file f where f.id=${id} and (exists(select 1 from "user" u where u.image=${"/media/" + id}) or exists(select 1 from chat c join chat_member cm on cm.chat_id=c.id where c.image=${"/media/" + id} and cm.user_id=${u.id}) or exists(select 1 from sticker s where s.file_id=f.id) or exists(select 1 from message m join chat_member cm on cm.chat_id=m.chat_id where m.type in ('photo','sticker','audio','circle') and (m.content->>'fileId'=${id} or (m.content->'fileIds') ? ${id}) and cm.user_id=${u.id}))`,
    );
    if (!file) return new Response(null, { status: 404 });
    const bytes = await storage.read(file.storage_key);
    const headers: Record<string, string> = {
      "Content-Type": file.mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    let range;
    try { range = byteRange(request.headers.get("range"), bytes.length); }
    catch { return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.length}` } }); }
    if (range) {
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${bytes.length}`;
      headers["Content-Length"] = String(range.end - range.start + 1);
      return new Response(Buffer.from(bytes.subarray(range.start, range.end + 1)), { status: 206, headers });
    }
    headers["Content-Length"] = String(bytes.length);
    return new Response(Buffer.from(bytes), { headers });
  } catch {
    return new Response(null, { status: 404 });
  }
}
