// Disposable PostgreSQL fixture: identical display names must not share mentions.
import assert from "node:assert/strict";
import {sql} from "drizzle-orm";
import {v7} from "uuid";
import {db,pool} from "../apps/api/src/db";
import {send,chatList,history} from "../apps/api/src/modules/chat/service";
const users=[{id:v7(),role:"user",name:"Отправитель"},{id:v7(),role:"user",name:"Иван Иванов"},{id:v7(),role:"user",name:"Иван Иванов"},{id:v7(),role:"admin",name:"Иван Иванов"}],chatId=v7();
try{
 for(const user of users)await db.execute(sql`insert into "user"(id,name,email,role) values(${user.id},${user.name},${user.id+'@example.com'},${user.role})`);
 await db.execute(sql`insert into chat(id,kind,owner_id) values(${chatId},'group',${users[0].id})`);
 for(const user of users.slice(0,3))await db.execute(sql`insert into chat_member(chat_id,user_id) values(${chatId},${user.id})`);
 const text=`@${users[1].name}`,mention={userId:users[1].id,start:0,length:text.length};
 const sent=await send(users[0],chatId,{clientMessageId:v7(),text,mentions:[mention]});
 assert.deepEqual((await history(chatId,users[1])).messages.find(m=>m.id===sent.id)!.content.mentions,[mention]);
 const unread=async(index:number)=>(await chatList(users[index])).find(c=>c.id===chatId)!.unreadMentions;
 assert.equal(await unread(1),1);assert.equal(await unread(2),0,"same name is not the same ID");assert.equal(await unread(0),0,"sender gets no incoming mention badge");
 await send(users[0],chatId,{clientMessageId:v7(),text});assert.equal(await unread(1),1,"plain @name text does not count");
 await db.execute(sql`update "user" set name='Другое Имя' where id=${users[1].id}`);assert.equal(await unread(1),1,"stored ID survives renaming");
 await assert.rejects(()=>send(users[0],chatId,{clientMessageId:v7(),text,mentions:[{...mention,userId:users[3].id}]}),(e:any)=>e.status===400);
 await db.execute(sql`update chat_member set last_read_at=(select created_at from message where id=${sent.id}) where chat_id=${chatId} and user_id=${users[1].id}`);assert.equal(await unread(1),0,"reading removes badge");
 console.log("PASS selected user ID, identical names, rename, literal text, membership and read-state badge");
}finally{await pool.end();}
