import { sql } from "drizzle-orm";
import { db } from "../../db";
import { rows } from "../chat/service";
import { storage } from "./storage";
// Delete only unreferenced files: forwards, avatars and the sticker catalog own references too.
export async function cleanupMediaBatch() {
  await db.transaction(async tx => {
    const jobs = await rows(sql`select id,payload from outbox where kind='media.cleanup' and processed_at is null order by created_at,id limit 10 for update skip locked`, tx);
    for (const job of jobs) {
      for (const id of [...new Set<string>(job.payload.fileIds ?? [])].sort()) {
        const [file] = await rows(sql`select * from media_file where id=${id} for update`, tx);
        if (!file) continue;
        const [used] = await rows(sql`select 1 where
          exists(select 1 from message where deleted_at is null and (content->>'fileId'=${id} or (content->'fileIds') ? ${id}))
          or exists(select 1 from sticker where file_id=${id})
          or exists(select 1 from "user" where image=${"/media/"+id})
          or exists(select 1 from chat where image=${"/media/"+id})`, tx);
        if (used) continue;
        try { await storage.remove(file.storage_key); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        await tx.execute(sql`delete from media_file where id=${id}`);
      }
      await tx.execute(sql`update outbox set processed_at=now() where id=${job.id}`);
    }
  });
}
