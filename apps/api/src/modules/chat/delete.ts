import { sql } from "drizzle-orm";
import { db } from "../../db";
import { HttpError } from "../../lib/http";
import { member, rows, writable, event, type Actor } from "./service";
export async function deleteMessage(actor: Actor, id: string) {
  return db.transaction(async tx => {
    await writable(tx, actor);
    const [message] = await rows(sql`select * from message where id=${id}`, tx);
    if (!message) throw new HttpError(404, "Сообщение не найдено");
    await member(message.chat_id, actor, tx, true);
    if (message.author_id !== actor.id) throw new HttpError(403, "Можно удалить только своё сообщение");
    // Keep the identity for cursor reconciliation and idempotency; erase the payload.
    const [current] = await rows(sql`select * from message where id=${id} for update`, tx);
    if (current.deleted_at) return { ok: true };
    const fileIds = [...new Set([...(current.content.fileIds ?? []), ...(current.content.fileId ? [current.content.fileId] : [])])];
    await tx.execute(sql`update message set type='deleted',content='{"text":"Сообщение удалено"}'::jsonb,deleted_at=clock_timestamp(),edited_at=null,forwarded_from=null,reply_to_id=null where id=${id}`);
    await tx.execute(sql`delete from pinned_message where message_id=${id}`);
    await tx.execute(sql`delete from reaction where message_id=${id}`);
    await tx.execute(sql`update push_delivery set completed_at=now(),outcome='deleted',lease_until=null where message_id=${id} and completed_at is null`);
    if (fileIds.length) await tx.execute(sql`insert into outbox(kind,payload) values('media.cleanup',${JSON.stringify({fileIds})}::jsonb)`);
    await event(tx, message.chat_id);
    return { ok: true };
  });
}
