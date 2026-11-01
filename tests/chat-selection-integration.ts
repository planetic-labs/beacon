// Requires a disposable PostgreSQL database. Exercises ownership even for admins/owners.
import assert from "node:assert/strict";
import {sql} from "drizzle-orm";
import {v7} from "uuid";
import {db,pool} from "../apps/api/src/db";
import {rows,history,offlineHistory,chatList} from "../apps/api/src/modules/chat/service";
import {applyChatSelection} from "../apps/api/src/modules/chat/selection";
import {saveFolder,folderList} from "../apps/api/src/modules/chat/folders";
const actors=[{id:v7(),role:"user"},{id:v7(),role:"user"},{id:v7(),role:"admin"}],group=v7(),direct=v7(),privateChat=v7(),file=v7();
const own=v7(),peer=v7(),admin=v7(),forward=v7();
try{
 for(const actor of actors)await db.execute(sql`insert into "user"(id,name,email,role) values(${actor.id},'Fixture',${actor.id+'@example.com'},${actor.role})`);
 for(const [id,kind,owner] of [[group,"group",actors[0].id],[direct,"direct",actors[0].id],[privateChat,"group",actors[2].id]])await db.execute(sql`insert into chat(id,kind,owner_id) values(${id},${kind},${owner})`);
 for(const chat of [group,direct])for(const actor of actors)await db.execute(sql`insert into chat_member(chat_id,user_id) values(${chat},${actor.id})`);
 await db.execute(sql`insert into chat_member(chat_id,user_id) values(${privateChat},${actors[2].id})`);
 await applyChatSelection(actors[1],{chatIds:[group,direct],action:"mute"});assert.ok((await chatList(actors[1])).every(c=>c.muted));assert.ok((await chatList(actors[0])).every(c=>!c.muted));
 await applyChatSelection(actors[1],{chatIds:[group,direct],action:"unmute"});assert.ok((await chatList(actors[1])).every(c=>!c.muted));
 await applyChatSelection(actors[1],{chatIds:[group,direct],action:"pin"});assert.ok((await chatList(actors[1])).every(c=>c.pinned));assert.ok((await chatList(actors[0])).every(c=>!c.pinned));
 await assert.rejects(()=>applyChatSelection(actors[1],{chatIds:[group,privateChat],action:"unpin"}),(e:any)=>e.status===403);assert.ok((await chatList(actors[1])).every(c=>c.pinned),"atomic authorization");
 const folder=await saveFolder(actors[1],undefined,{name:"Моя папка",chatIds:[direct]});await applyChatSelection(actors[1],{chatIds:[group,direct],action:"folder",folderId:folder.id});assert.deepEqual(new Set((await folderList(actors[1]))[0].chatIds),new Set([group,direct]));
 await assert.rejects(()=>applyChatSelection(actors[0],{chatIds:[group],action:"folder",folderId:folder.id}),(e:any)=>e.status===404);
 await db.execute(sql`insert into media_file(id,owner_id,storage_key,mime,size) values(${file},${actors[1].id},${file},'image/png',10)`);
 for(const [id,author,content] of [[own,actors[0].id,{text:"Владелец"}],[peer,actors[1].id,{fileIds:[file]}],[admin,actors[2].id,{text:"Администратор"}],[forward,actors[2].id,{fileIds:[file]}]] as const)await db.execute(sql`insert into message(id,chat_id,author_id,client_message_id,type,content) values(${id},${group},${author},${id},'text',${JSON.stringify(content)}::jsonb)`);
 for(const id of [own,peer]){await db.execute(sql`insert into pinned_message(message_id,pinned_by) values(${id},${actors[0].id})`);await db.execute(sql`insert into reaction(message_id,user_id,emoji) values(${id},${actors[2].id},'❤️')`);}
 await applyChatSelection(actors[1],{chatIds:[group],action:"delete-own"});
 let data=await history(group,actors[0]);assert.equal(data.messages.find(m=>m.id===peer)!.type,"deleted");assert.equal(data.messages.find(m=>m.id===own)!.type,"text");assert.equal(data.messages.find(m=>m.id===forward)!.type,"text");assert.equal(data.historyRevision,1);
 assert.equal((await rows(sql`select * from pinned_message where message_id=${own}`)).length,1);assert.equal((await rows(sql`select * from pinned_message where message_id=${peer}`)).length,0);assert.equal((await rows(sql`select * from reaction where message_id=${peer}`)).length,0);
 assert.deepEqual(data.messages.find(m=>m.id===forward)!.content.fileIds,[file]);assert.equal((await rows(sql`select * from media_file where id=${file}`)).length,1);
 await applyChatSelection(actors[1],{chatIds:[group],action:"delete-own"});assert.equal((await offlineHistory(group,actors[0])).historyRevision,1,"idempotent deletion does not invalidate again");
 await applyChatSelection(actors[0],{chatIds:[group],action:"delete-own"});data=await history(group,actors[1]);assert.equal(data.messages.find(m=>m.id===admin)!.type,"text","group owner cannot erase admin messages");
 await applyChatSelection(actors[2],{chatIds:[group],action:"delete-own"});assert.ok((await history(group,actors[1])).messages.every(m=>m.type==="deleted"));assert.equal((await rows(sql`select * from chat_member where chat_id=${group}`)).length,3,"membership and chat preserved");
 assert.ok((await rows(sql`select payload from outbox where kind='media.cleanup'`)).some(row=>row.payload.fileIds.includes(file)));
 await db.execute(sql`update "user" set banned=true where id=${actors[1].id}`);await assert.rejects(()=>applyChatSelection(actors[1],{chatIds:[direct],action:"pin"}),(e:any)=>e.status===401);
 console.log("PASS batch pin/mute/folders, atomic access, own-only deletion for owner/admin, history revision and retained forwarding");
}finally{await pool.end();}
