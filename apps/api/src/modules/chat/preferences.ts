import { sql } from "drizzle-orm";
import { db } from "../../db";
import { HttpError } from "../../lib/http";
import { type Actor, rows, writable, member, event } from "./service";
import { validateMentions } from "./mentions";
import type { Mention } from "@beacon/shared";
// Drafts and pins belong to membership, never to the public conversation.
export async function draftList(actor:Actor){
  return rows(sql`select chat_id as "chatId",draft,draft_revision as revision from chat_member where user_id=${actor.id}`);
}
export async function saveDraft(actor:Actor,chatId:string,input:{text:string;mentions:Mention[];revision:number}){
  return db.transaction(async tx=>{
    await writable(tx,actor);await member(chatId,actor,tx,true);
    const [current]=await rows(sql`select draft_revision from chat_member where chat_id=${chatId} and user_id=${actor.id}`,tx);
    if(current.draft_revision!==input.revision)throw new HttpError(409,"Черновик обновлён на другом устройстве");
    // Use the same canonical validation as messages. Deleted/changed members must not prevent saving text.
    let mentions:Mention[]=[];
    try{mentions=await validateMentions(tx,chatId,input.text,input.mentions);}catch(error){if(!(error instanceof HttpError))throw error;}
    const [saved]=await rows(sql`update chat_member set draft=${JSON.stringify({text:input.text,mentions})}::jsonb,draft_revision=draft_revision+1 where chat_id=${chatId} and user_id=${actor.id} returning chat_id as "chatId",draft,draft_revision as revision`,tx);
    await tx.execute(sql`insert into outbox(kind,payload) values('draft.changed',${JSON.stringify({chatId,userIds:[actor.id]})}::jsonb)`);return saved;
  });
}
export async function pinChat(actor:Actor,chatId:string,pinned:boolean){
  return db.transaction(async tx=>{
    await writable(tx,actor);await member(chatId,actor,tx,true);
    await tx.execute(sql`update chat_member set pinned=${pinned} where chat_id=${chatId} and user_id=${actor.id}`);
    await event(tx,chatId,[actor.id]);return {ok:true};
  });
}
