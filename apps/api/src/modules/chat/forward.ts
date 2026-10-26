import { sql } from "drizzle-orm";
import { db } from "../../db";
import { HttpError } from "../../lib/http";
import { member, rows, writable, send, event, type Actor } from "./service";
export async function forwardBatch(actor:Actor,chatId:string,items:{forwardId:string;clientMessageId:string}[]) {
  items=items.map(i=>({forwardId:i.forwardId.toLowerCase(),clientMessageId:i.clientMessageId.toLowerCase()}));
  if(new Set(items.map(i=>i.forwardId)).size!==items.length||new Set(items.map(i=>i.clientMessageId)).size!==items.length)throw new HttpError(400,"Повторяющиеся сообщения");
  return db.transaction(async tx=>{
    await writable(tx,actor);await member(chatId,actor,tx,true);
    const old=await rows(sql`select id,chat_id,client_message_id from message where author_id=${actor.id} and client_message_id in (${sql.join(items.map(i=>sql`${i.clientMessageId}`),sql`,`)}) order by created_at,id`,tx);
    if(old.length){
      if(old.length!==items.length||old.some(m=>m.chat_id!==chatId))throw new HttpError(409,"Идентификаторы пересылки уже использованы");
      return {ids:old.map(m=>m.id)};
    }
    // Validate and lock every source first: an inaccessible/deleted item rolls back the whole batch.
    const sources=await rows(sql`select m.id from message m join chat_member cm on cm.chat_id=m.chat_id and cm.user_id=${actor.id}
      where m.id in (${sql.join(items.map(i=>sql`${i.forwardId}`),sql`,`)}) and m.deleted_at is null order by m.created_at,m.id for share of m`,tx);
    if(sources.length!==items.length)throw new HttpError(403,"Одно из сообщений больше недоступно");
    const ids:string[]=[];
    for(const source of sources){
      const item=items.find(i=>i.forwardId===source.id)!;
      const sent=await send(actor,chatId,{...item,text:""},tx,false);ids.push(sent.id);
    }
    await event(tx,chatId);
    return {ids};
  });
}
