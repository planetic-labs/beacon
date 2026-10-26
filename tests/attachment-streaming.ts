// Large uploads exercise real socket backpressure, never buffer a whole fixture in memory.
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createChatFixtures } from "./chat-fixtures";
import { pool } from "../apps/api/src/db";
import { v7 } from "uuid";
if(process.env.APP_ENV!=="test")throw new Error("Disposable test deployment required");
const base=process.env.APP_URL!;
const fixtures=await createChatFixtures();
try{
const cookie=(index:number)=>`${fixtures.users[index].cookieName}=${fixtures.users[index].cookieValue}`;
async function upload(kind:"file"|"video",size:number, options:{signal?:AbortSignal;hold?:boolean}={}) {
 const boundary=`test-${v7()}`,clientId=v7();
 const field=(name:string,value:string)=>`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
 const prefix=field("chatId",fixtures.chatId)+field("clientMessageId",clientId)+field("kind",kind)+field("text","")+`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="stream.${kind==="video"?"mp4":"zip"}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
 async function* chunks(){yield Buffer.from(prefix);const chunk=Buffer.alloc(64*1024);chunk.write("ftyp",4);for(let sent=0;sent<size;sent+=chunk.length){yield chunk.subarray(0,Math.min(chunk.length,size-sent));if(options.hold&&sent===0)await new Promise(r=>setTimeout(r,2000));}yield Buffer.from(`\r\n--${boundary}--\r\n`);}
 const response=await fetch(`${base}/api/attachments`,{method:"POST",signal:options.signal,headers:{cookie:cookie(0),origin:base,"content-type":`multipart/form-data; boundary=${boundary}`},body:Readable.toWeb(Readable.from(chunks())) as ReadableStream<Uint8Array>,duplex:"half"} as RequestInit);
 return response;
}
const size=500*1024*1024;
const start=Date.now();const response=await upload("video",size);assert.equal(response.status,200,await response.clone().text());const messageId=(await response.json() as {id:string}).id;
const history=await(await fetch(`${base}/api/v1/chats/${fixtures.chatId}/messages`,{headers:{cookie:cookie(1)}})).json() as any;
const message=history.messages.find((m:{id:string})=>m.id===messageId);assert.equal(message.content.size,size);
const url=`${base}/media/${message.content.fileId}`;
const media=await fetch(url,{headers:{cookie:cookie(1),range:"bytes=1048576-1048607"}});assert.equal(media.status,206);assert.equal((await media.arrayBuffer()).byteLength,32);assert.equal(media.headers.get("content-range"),`bytes 1048576-1048607/${size}`);
const tooLarge=await upload("file",100*1024*1024+1);assert.equal(tooLarge.status,413,await tooLarge.clone().text());
const deleted=await fetch(`${base}/api/v1/messages/${messageId}`,{method:"DELETE",headers:{cookie:cookie(0),origin:base}});assert.equal(deleted.status,200);
assert.equal((await fetch(url,{headers:{cookie:cookie(1)}})).status,404);
// The upload lease is released after limit errors, allowing another request.
assert.equal((await upload("file",128)).status,200);
const controllers=[new AbortController(),new AbortController()];
const pending=controllers.map(controller=>upload("file",1024*1024,{signal:controller.signal,hold:true}).catch(()=>undefined));
await new Promise(r=>setTimeout(r,350));
assert.equal((await upload("file",128)).status,429,"bound concurrent uploads before reading bodies");
controllers.forEach(controller=>controller.abort());await Promise.all(pending);await new Promise(r=>setTimeout(r,250));
assert.equal((await upload("file",128)).status,200,"cancelled uploads release concurrency slots");
console.log(`PASS 500 MiB streaming video, partial download, 100 MiB limit and deletion (${Math.round((Date.now()-start)/1000)}s)`);

}finally{await pool.end();}
