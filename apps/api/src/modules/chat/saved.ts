import { sql } from "drizzle-orm";
import { db } from "../../db";
import { rows, writable, event, type Actor } from "./service";
export async function savedChat(actor:Actor) {
  return db.transaction(async tx=>{
    await writable(tx,actor);
    const key=`saved:${actor.id}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`);
    const [existing]=await rows(sql`select id from chat where direct_key=${key}`,tx);
    if(existing)return existing;
    const [chat]=await rows(sql`insert into chat(kind,title,owner_id,direct_key) values('saved','Избранное',${actor.id},${key}) returning id`,tx);
    await tx.execute(sql`insert into chat_member(chat_id,user_id) values(${chat.id},${actor.id})`);
    await event(tx,chat.id,[actor.id]);return chat;
  });
}
