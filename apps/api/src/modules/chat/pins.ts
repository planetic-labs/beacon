import { sql } from "drizzle-orm";
import { db } from "../../db";
import { HttpError } from "../../lib/http";
import { member, rows, writable, event, type Actor } from "./service";
export async function setPin(actor:Actor,id:string,pinned:boolean) {
  await db.transaction(async tx=>{
    await writable(tx,actor);
    const [message]=await rows(sql`select chat_id from message where id=${id}`,tx);
    if(!message)throw new HttpError(404,"Сообщение не найдено");
    await member(message.chat_id,actor,tx,true);
    const [current]=await rows(sql`select id from message where id=${id} and deleted_at is null for share`,tx);
    if(!current)throw new HttpError(409,"Сообщение удалено");
    const changed=pinned
      ?await rows(sql`insert into pinned_message(message_id,pinned_by) values(${id},${actor.id}) on conflict do nothing returning message_id`,tx)
      :await rows(sql`delete from pinned_message where message_id=${id} returning message_id`,tx);
    if(changed.length)await event(tx,message.chat_id);
  });
}
export async function pins(chatId:string,actor:Actor,cursor?:{id:string;at:string}) {
  await member(chatId,actor);
  const result=await rows(sql`select m.id,m.type,u.name as "authorName",coalesce(nullif(m.content->>'text',''),m.content->>'name',case when m.type='photo' then 'Фото' else 'Сообщение' end) as text,p.pinned_by as "pinnedBy",
    to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "pinnedAt"
    from pinned_message p join message m on m.id=p.message_id join "user" u on u.id=m.author_id
    where m.chat_id=${chatId} and m.deleted_at is null and exists(select 1 from chat_member cm where cm.chat_id=m.chat_id and cm.user_id=${actor.id})
    ${cursor?sql`and (p.created_at,p.message_id)<(${cursor.at}::timestamptz,${cursor.id}::uuid)`:sql``}
    order by p.created_at desc,p.message_id desc limit 51`);
  const [count]=await rows(sql`select count(*)::int as total from pinned_message p join message m on m.id=p.message_id where m.chat_id=${chatId} and m.deleted_at is null and exists(select 1 from chat_member cm where cm.chat_id=m.chat_id and cm.user_id=${actor.id})`);
  const page=result.slice(0,50),last=page.at(-1);
  return {pins:page,total:count.total,...(result.length>50&&last?{next:{id:last.id,at:last.pinnedAt}}:{})};
}
