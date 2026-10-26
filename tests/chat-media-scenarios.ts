import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { v7 } from "uuid";
import { sql } from "drizzle-orm";
import { db } from "../apps/api/src/db";
type Call=(path:string,method?:string,body?:unknown,cookie?:string)=>Promise<Response>;
export async function chatMediaScenarios(http:(request:Request)=>Promise<Response>,call:Call,ids:string[],cookies:string[]) {
 const [admin,one,two]=cookies,base=process.env.APP_URL!;
 const group=await(await call("chats","POST",{kind:"group",title:"Media and receipts",userIds:[ids[2]]},one)).json();
 const send=async(text:string)=>{const r=await call(`chats/${group.id}/messages`,"POST",{clientMessageId:v7(),text},one);assert.equal(r.status,200);return(await r.json()).id as string;};
 const details=async(id:string)=>{const r=await call(`messages/${id}/receipts`,"GET",undefined,one);assert.equal(r.status,200,await r.clone().text());return await r.json();};
 const old=await send("Legacy read timestamp unknown");
 await db.execute(sql`update chat_member set last_read_at=(select created_at from message where id=${old}),last_delivered_at=(select created_at from message where id=${old}) where chat_id=${group.id} and user_id=${ids[2]}`);
 let rows=await details(old);assert.equal(rows[0].status,"read");assert.equal(rows[0].readAt,null);assert.equal(rows[0].deliveredAt,null);
 const first=await send("New exact receipt one"),second=await send("New exact receipt two");
 assert.equal((await call(`messages/${first}/receipts`,"GET",undefined,two)).status,403);
 assert.equal((await call(`messages/${first}/receipts`,"GET",undefined,admin)).status,403);
 await call("receipts/delivered","POST",{items:[{chatId:group.id,messageId:second}]},two);
 rows=await details(first);assert.equal(rows[0].status,"delivered");assert.ok(rows[0].deliveredAt);assert.equal(rows[0].readAt,null);
 await call(`chats/${group.id}/read`,"POST",{messageId:first},two);
 const initial=(await details(first))[0];assert.equal(initial.status,"read");assert.ok(initial.readAt);
 await call(`chats/${group.id}/read`,"POST",{messageId:second},two);
 assert.equal((await details(first))[0].readAt,initial.readAt,"later reads never overwrite the original acknowledgement time");
 const checkpoints=Number((await db.execute(sql`select count(*) as n from receipt_checkpoint where chat_id=${group.id}`)).rows[0].n);
 await call(`chats/${group.id}/read`,"POST",{messageId:first},two);
 assert.equal(Number((await db.execute(sql`select count(*) as n from receipt_checkpoint where chat_id=${group.id}`)).rows[0].n),checkpoints,"retries do not create receipt timestamps");
 await call(`chats/${group.id}`,"PATCH",{add:ids[0]},one);assert.equal((await details(first)).length,1,"late joiners were not original recipients");
 await call(`messages/${first}`,"DELETE",undefined,one);assert.equal((await call(`messages/${first}/receipts`,"GET",undefined,one)).status,404);
 const sharp=createRequire(new URL("../apps/api/package.json",import.meta.url))("sharp");
 const png=await sharp({create:{width:32,height:24,channels:4,background:"red"}}).png().toBuffer();
 const photo=async(count:number)=>{const form=new FormData();form.set("chatId",group.id);form.set("clientMessageId",v7());form.set("text","Альбом https://example.com/photo");for(let i=0;i<count;i++)form.append("file",new File([new Uint8Array(png)],`photo-${i}.png`));const r=await http(new Request(`${base}/api/photos`,{method:"POST",headers:{cookie:one,origin:base},body:form}));assert.equal(r.status,200,await r.clone().text());return(await r.json()).id as string;};
 const album1=await photo(2),album2=await photo(1);
 const album=await(await call(`chats/${group.id}/photos/${album1}`,"GET",undefined,two)).json();assert.equal(album.files.length,2);assert.equal(album.nextMessageId,album2);assert.equal(album.previousMessageId,undefined);
 const gallery=await(await call(`chats/${group.id}/attachments?kind=photo`,"GET",undefined,two)).json();assert.equal(gallery.items.length,2);assert.equal(gallery.items[0].messageId,album2);
 const fileId=album.files[0].id;
 const preview=await http(new Request(`${base}/media/${fileId}?thumbnail=1`,{headers:{cookie:two}}));assert.equal(preview.status,200);assert.equal(preview.headers.get("content-type"),"image/webp");assert.ok((await preview.arrayBuffer()).byteLength<100000);
 const download=await http(new Request(`${base}/media/${fileId}?download=1`,{headers:{cookie:two}}));assert.match(download.headers.get("content-disposition")!,/^attachment;/);await download.arrayBuffer();
 const links=await(await call(`chats/${group.id}/attachments?kind=links`,"GET",undefined,two)).json();assert.deepEqual(links.items[0].links,["https://example.com/photo"]);
 for(let i=0;i<35;i++)await db.execute(sql`insert into message(chat_id,author_id,client_message_id,content) values(${group.id},${ids[1]},${v7()},'{"text":"https://example.com/page"}'::jsonb)`);
 const page1=await(await call(`chats/${group.id}/attachments?kind=links`,"GET",undefined,two)).json();assert.equal(page1.items.length,30);assert.ok(page1.next);
 const page2=await(await call(`chats/${group.id}/attachments?kind=links&beforeId=${page1.next.id}&beforeAt=${encodeURIComponent(page1.next.at)}`,"GET",undefined,two)).json();assert.equal(new Set([...page1.items,...page2.items].map((m:{messageId:string})=>m.messageId)).size,37);
 await call(`messages/${album1}`,"DELETE",undefined,one);
 assert.equal((await call(`chats/${group.id}/photos/${album1}`,"GET",undefined,two)).status,404);
 assert.equal((await http(new Request(`${base}/media/${fileId}?thumbnail=1`,{headers:{cookie:two}}))).status,404,"a cached derivative must recheck access");
 const next=await(await call(`chats/${group.id}/photos/${album2}`,"GET",undefined,two)).json();assert.equal(next.previousMessageId,undefined);
 for(const kind of ["file","video"]){
  const form=new FormData();form.set("chatId",group.id);form.set("clientMessageId",v7());form.set("kind",kind);form.set("text","");const bytes=new Uint8Array(32);if(kind==="video")bytes.set(new TextEncoder().encode("ftyp"),4);form.set("file",new File([bytes],kind==="file"?"archive.zip":"video.mp4"));
  const sent=await http(new Request(`${base}/api/attachments`,{method:"POST",headers:{cookie:one,origin:base},body:form}));assert.equal(sent.status,200,await sent.clone().text());
  const list=await(await call(`chats/${group.id}/attachments?kind=${kind}`,"GET",undefined,two)).json();assert.equal(list.items.length,1);assert.equal(list.items[0].files.length,1);
 }
 for(const type of ["audio","circle"]){
  const [sample]=(await db.execute(sql`select m.id,m.chat_id from message m join chat_member cm on cm.chat_id=m.chat_id and cm.user_id=${ids[1]} where m.type=${type} and m.deleted_at is null limit 1`)).rows;
  assert.ok(sample);const list=await(await call(`chats/${sample.chat_id}/attachments?kind=${type==="circle"?"video":"audio"}`,"GET",undefined,one)).json();assert.ok(list.items.some((m:{messageId:string})=>m.messageId===sample.id));
 }
 await call(`chats/${group.id}`,"PATCH",{remove:ids[2]},one);
 assert.equal((await call(`chats/${group.id}/attachments?kind=photo`,"GET",undefined,two)).status,403);assert.equal((await call(`chats/${group.id}/photos/${album2}`,"GET",undefined,two)).status,403);
}
