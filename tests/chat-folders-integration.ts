// Run only with a disposable PostgreSQL database; never targets dev accounts.
import assert from "node:assert/strict";
import {sql} from "drizzle-orm";
import {v7} from "uuid";
import {db,pool} from "../apps/api/src/db";
import {folderList,saveFolder,deleteFolder} from "../apps/api/src/modules/chat/folders";
import {rows} from "../apps/api/src/modules/chat/service";
const owner={id:v7(),role:"user"},other={id:v7(),role:"admin"},chatId=v7(),privateId=v7(),savedId=v7();
try{
 for(const actor of [owner,other])await db.execute(sql`insert into "user"(id,name,email) values(${actor.id},'Fixture',${actor.id+'@example.com'})`);
 for(const [id,kind,actor] of [[chatId,"group",owner],[privateId,"group",other],[savedId,"saved",owner]] as const){await db.execute(sql`insert into chat(id,kind,owner_id) values(${id},${kind},${actor.id})`);await db.execute(sql`insert into chat_member(chat_id,user_id) values(${id},${actor.id})`);}
 const folder=await saveFolder(owner,undefined,{name:"Личные",chatIds:[chatId,chatId]});
 assert.equal((await folderList(owner))[0].name,"Личные");assert.deepEqual((await folderList(owner))[0].chatIds,[chatId]);
 assert.deepEqual(await folderList(other),[]);
 for(const task of [()=>saveFolder(other,folder.id,{name:"Forged",chatIds:[]}),()=>deleteFolder(other,folder.id)])await assert.rejects(task,(e:any)=>e.status===404);
 for(const id of [privateId,savedId])await assert.rejects(()=>saveFolder(owner,folder.id,{name:"Invalid",chatIds:[id]}),(e:any)=>e.status===403);
 assert.equal((await folderList(owner))[0].name,"Личные","invalid replacement rolls back");
 await saveFolder(owner,folder.id,{name:"Общение",chatIds:[]});assert.deepEqual((await folderList(owner))[0].chatIds,[]);
 await saveFolder(owner,folder.id,{name:"Общение",chatIds:[chatId]});
 await db.execute(sql`delete from chat_member where chat_id=${chatId} and user_id=${owner.id}`);assert.deepEqual((await folderList(owner))[0].chatIds,[],"revoked membership is not exposed");
 await deleteFolder(owner,folder.id);assert.deepEqual(await folderList(owner),[]);assert.equal((await rows(sql`select id from chat where id=${chatId}`)).length,1,"folder deletion preserves chat");
 for(let i=0;i<20;i++)await saveFolder(owner,undefined,{name:`Folder ${i}`,chatIds:[]});
 await assert.rejects(()=>saveFolder(owner,undefined,{name:"Too many",chatIds:[]}),(e:any)=>e.status===400);
 const events=await rows(sql`select payload from outbox where kind='folders.changed'`);assert.ok(events.length);assert.ok(events.every(event=>event.payload.userIds.length===1&&event.payload.userIds[0]===owner.id));
 await db.execute(sql`update "user" set banned=true where id=${owner.id}`);const blockedFolder=(await folderList(owner))[0].id;await assert.rejects(()=>deleteFolder(owner,blockedFolder),(e:any)=>e.status===401);
 console.log("PASS personal folder persistence, ownership, membership, rollback, limits and preserved chats");
}finally{await pool.end();}
