import { sql } from "drizzle-orm";
import { db } from "../../db";
import { member, rows, writable, type Actor } from "./service";
import { HttpError } from "../../lib/http";
export async function receipts(chatId: string, actor: Actor) {
  await member(chatId, actor);
  return rows(sql`select cm.user_id as "userId",u.name,
    to_char(cm.joined_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "joinedAt",
    to_char(cm.last_delivered_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "deliveredAt",
    to_char(cm.last_read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "readAt"
    from chat_member cm join "user" u on u.id=cm.user_id where cm.chat_id=${chatId}`);
}
export async function acknowledge(actor: Actor, items: { chatId: string; messageId: string }[], read = false) {
  await db.transaction(async tx => {
    await writable(tx, actor);
    for (const item of [...items].sort((a,b) => a.chatId.localeCompare(b.chatId))) {
      await member(item.chatId, actor, tx, true);
      const [message] = await rows(sql`select to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at from message where id=${item.messageId} and chat_id=${item.chatId}`, tx);
      if (!message) throw new HttpError(404, "Сообщение не найдено");
      // Use the previous cursor inside the chat lock; a retry never creates a new timestamp.
      for(const kind of read?["delivered","read"]:["delivered"]){
        const previous=kind==="read"?sql`last_read_at`:sql`last_delivered_at`;
        await tx.execute(sql`insert into receipt_checkpoint(chat_id,user_id,joined_at,kind,from_at,through_at)
          select chat_id,user_id,joined_at,${kind},${previous},${message.created_at}::timestamptz from chat_member
          where chat_id=${item.chatId} and user_id=${actor.id} and ${previous}<${message.created_at}::timestamptz`);
      }
      const changed = await rows(sql`update chat_member set last_delivered_at=greatest(last_delivered_at,${message.created_at}::timestamptz) ${read ? sql`,last_read_at=greatest(last_read_at,${message.created_at}::timestamptz)` : sql``}
        where chat_id=${item.chatId} and user_id=${actor.id} and (last_delivered_at<${message.created_at}::timestamptz ${read ? sql`or last_read_at<${message.created_at}::timestamptz` : sql``}) returning user_id`, tx);
      if (changed.length) {
        const ids = (await rows(sql`select user_id from chat_member where chat_id=${item.chatId}`,tx)).map(r=>r.user_id);
        await tx.execute(sql`insert into outbox(kind,payload) values('receipt.changed',${JSON.stringify({chatId:item.chatId,userIds:ids})}::jsonb)`);
      }
    }
  });
}

export async function messageReceipts(actor:Actor,id:string) {
  const [message]=await rows(sql`select chat_id,author_id from message where id=${id} and deleted_at is null`);
  if(!message)throw new HttpError(404,"Сообщение не найдено");
  await member(message.chat_id,actor);
  if(message.author_id!==actor.id)throw new HttpError(403,"Подробности доступны автору сообщения");
  return rows(sql`select cm.user_id as "userId",u.name,u.image,
    case when cm.last_read_at>=m.created_at then 'read' when cm.last_delivered_at>=m.created_at then 'delivered' else 'sent' end as status,
    (select case when checkpoint.from_at<m.created_at then checkpoint.acknowledged_at end from
      (select p.from_at,p.acknowledged_at from receipt_checkpoint p where p.chat_id=m.chat_id and p.user_id=cm.user_id and p.joined_at=cm.joined_at and p.kind='read' and p.through_at>=m.created_at order by p.through_at limit 1) checkpoint) as "readAt",
    (select case when checkpoint.from_at<m.created_at then checkpoint.acknowledged_at end from
      (select p.from_at,p.acknowledged_at from receipt_checkpoint p where p.chat_id=m.chat_id and p.user_id=cm.user_id and p.joined_at=cm.joined_at and p.kind='delivered' and p.through_at>=m.created_at order by p.through_at limit 1) checkpoint) as "deliveredAt"
    from message m join chat_member cm on cm.chat_id=m.chat_id and cm.user_id<>m.author_id and cm.joined_at<=m.created_at join "user" u on u.id=cm.user_id
    where m.id=${id} and m.author_id=${actor.id} and m.deleted_at is null and exists(select 1 from chat_member own where own.chat_id=m.chat_id and own.user_id=${actor.id}) order by u.name,u.id`);
}
