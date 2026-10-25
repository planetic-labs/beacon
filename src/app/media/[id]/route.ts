import { actor } from "@/lib/http";
import { rows } from "@/modules/chat/service";
import { storage } from "@/modules/media/storage";
import { sql } from "drizzle-orm";
import { z } from "zod";
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const u = await actor(request.headers);
    const id = z.uuid().parse((await ctx.params).id);
    // Initially only profile avatars are served. Future attachment policies live here.
    const [file] = await rows(
      sql`select f.* from media_file f where f.id=${id} and (exists(select 1 from "user" u where u.image=${"/media/" + id}) or exists(select 1 from chat c join chat_member cm on cm.chat_id=c.id where c.image=${"/media/" + id} and cm.user_id=${u.id}))`,
    );
    if (!file) return new Response(null, { status: 404 });
    const bytes = await storage.read(file.storage_key);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": file.mime,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
