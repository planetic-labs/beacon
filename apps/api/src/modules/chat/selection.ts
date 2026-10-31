import {sql} from "drizzle-orm";
import {db} from "../../db";
import {HttpError} from "../../lib/http";
import {rows,writable,member,event,type Actor} from "./service";
export type ChatSelectionAction="mute"|"unmute"|"pin"|"unpin"|"folder"|"delete-own";
export async function applyChatSelection(actor:Actor,input:{chatIds:string[];action:ChatSelectionAction;folderId?:string}){
 const ids=[...new Set(input.chatIds)].sort();
 return db.transaction(async tx=>{
  await writable(tx,actor);
  for(const id of ids)await member(id,actor,tx,true);
  if(input.action==="folder"){
   if(!input.folderId)throw new HttpError(400,"Выберите папку");
   const [folder]=await rows(sql`select id from chat_folder where id=${input.folderId} and user_id=${actor.id} for update`,tx);
   if(!folder)throw new HttpError(404,"Папка не найдена");
   const existing=await rows(sql`select chat_id from chat_folder_item where folder_id=${folder.id}`,tx);
   if(new Set([...existing.map(row=>row.chat_id),...ids]).size>200)throw new HttpError(400,"В папке может быть до 200 переписок");
   for(const id of ids){const [chat]=await rows(sql`select kind from chat where id=${id}`,tx);if(chat.kind==="saved")throw new HttpError(400,"Избранное не добавляется в папки");await tx.execute(sql`insert into chat_folder_item(folder_id,chat_id) values(${folder.id},${id}) on conflict do nothing`);}
   await tx.execute(sql`insert into outbox(kind,payload) values('folders.changed',${JSON.stringify({userIds:[actor.id]})}::jsonb)`);
  }else for(const id of ids){
   if(input.action==="mute"||input.action==="unmute"){await tx.execute(sql`insert into chat_notification_preference(user_id,chat_id,muted) values(${actor.id},${id},${input.action==="mute"}) on conflict(user_id,chat_id) do update set muted=excluded.muted`);await event(tx,id,[actor.id]);}
   else if(input.action==="pin"||input.action==="unpin"){await tx.execute(sql`update chat_member set pinned=${input.action==="pin"} where chat_id=${id} and user_id=${actor.id}`);await event(tx,id,[actor.id]);}
   else if(input.action==="delete-own"){
    // Keep message identities for offline reconciliation and idempotent retries.
    // Media cleanup still checks references from forwarded messages in other chats.
    await tx.execute(sql`insert into outbox(kind,payload) select 'media.cleanup',jsonb_build_object('fileIds',coalesce(m.content->'fileIds','[]'::jsonb)||case when m.content->>'fileId' is null then '[]'::jsonb else jsonb_build_array(m.content->>'fileId') end) from message m where m.chat_id=${id} and m.author_id=${actor.id} and m.deleted_at is null and (m.content?'fileId' or m.content?'fileIds')`);
    await tx.execute(sql`delete from pinned_message where message_id in(select id from message where chat_id=${id} and author_id=${actor.id})`);
    await tx.execute(sql`delete from reaction where message_id in(select id from message where chat_id=${id} and author_id=${actor.id})`);
    await tx.execute(sql`update push_delivery set completed_at=now(),outcome='deleted',lease_until=null where message_id in(select id from message where chat_id=${id} and author_id=${actor.id}) and completed_at is null`);
    const result=await tx.execute(sql`update message set type='deleted',content='{"text":"Сообщение удалено"}'::jsonb,deleted_at=clock_timestamp(),edited_at=null,forwarded_from=null,reply_to_id=null where chat_id=${id} and author_id=${actor.id} and deleted_at is null`);
    if(result.rowCount){await tx.execute(sql`update chat set history_revision=history_revision+1 where id=${id}`);await event(tx,id);}
   }
  }
  return {ok:true};
 });
}
