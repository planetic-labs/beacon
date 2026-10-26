import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { io, type Socket } from "socket.io-client";
import { v7 } from "uuid";
import { sql } from "drizzle-orm";
import { makeSignature } from "better-auth/crypto";
import { db,pool } from "../apps/api/src/db";
import { auth } from "../apps/api/src/modules/auth/config";
if(process.env.APP_ENV!=="test")throw new Error("Disposable test environment required");
const base=process.env.APP_URL!,socketUrl=process.env.TEST_SOCKET_URL??"http://localhost:3001";
const apiBase=process.env.TEST_API_URL??base;
const fixtures=JSON.parse(await readFile("/run/test/browser.json","utf8"));
const sockets:Socket[]=[];
function wait(socket:Socket,event:string,predicate:(data:any)=>boolean=()=>true,timeout=5000):Promise<any>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(event,handler);reject(new Error(`Timed out: ${event}`));},timeout);const handler=(data:any)=>{if(predicate(data)){clearTimeout(timer);socket.off(event,handler);resolve(data);}};socket.on(event,handler);});}
try{
 const third=v7();await db.execute(sql`insert into "user"(id,name,first_name,last_name,email,role) values(${third},'Private Admin','Private','Admin',${`test-${third}@example.com`},'admin')`);
 const ctx=await auth.$context,session=await ctx.internalAdapter.createSession(third);assert.ok(session);
 const thirdCookie=`${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${await makeSignature(session.token,process.env.BETTER_AUTH_SECRET!)}`)}`;
 for(const cookie of [...fixtures.users.map((u:any)=>`${u.cookieName}=${u.cookieValue}`),thirdCookie]){
  const s=io(socketUrl,{autoConnect:false,transports:["websocket"],extraHeaders:{cookie,origin:base}});sockets.push(s);const ready=wait(s,"connect");s.connect();await ready;
 }
 const [a,b,outsider]=sockets;
 const firstCookie=`${fixtures.users[0].cookieName}=${fixtures.users[0].cookieValue}`;
 const presence=async()=>{const result=await(await fetch(`${apiBase}/api/v1/presence`,{headers:{cookie:firstCookie}})).json() as any[];return result.find(p=>p.userId===fixtures.users[0].id);};
 const onlineEvent=wait(b,"presence.changed",data=>data.userId===fixtures.users[0].id);a.emit("presence.heartbeat",{visible:true});await onlineEvent;assert.equal((await presence()).online,true);
 const otherDevice=io(socketUrl,{autoConnect:false,transports:["websocket"],extraHeaders:{cookie:firstCookie,origin:base}});sockets.push(otherDevice);const otherReady=wait(otherDevice,"connect");otherDevice.connect();await otherReady;
 otherDevice.emit("presence.heartbeat",{visible:true});
 let devices=0;for(let i=0;i<40;i++){devices=Number((await db.execute(sql`select count(*) as n from presence_lease where user_id=${fixtures.users[0].id} and expires_at>now()`)).rows[0].n);if(devices>=2)break;await new Promise(r=>setTimeout(r,50));}assert.equal(devices,2);
let leaked=false;outsider.on("chat.activity",()=>{leaked=true;});
 const event=wait(b,"chat.activity",d=>d.kind==="typing");a.emit("chat.activity",{chatId:fixtures.chatId,kind:"typing"});const activity=await event;
 assert.equal(activity.userId,fixtures.users[0].id);assert.equal(activity.name,`${fixtures.users[0].firstName} ${fixtures.users[0].lastName}`);assert.ok(activity.expiresAt>Date.now()&&activity.expiresAt<=Date.now()+6500);
 // Server throttle protects DB access while allowing a later stop/update.
 await new Promise(r=>setTimeout(r,450));const audio=wait(b,"chat.activity",d=>d.kind==="audio");a.emit("chat.activity",{chatId:fixtures.chatId,kind:"audio"});await audio;
 const stopped=wait(b,"chat.activity",d=>d.kind===null);a.disconnect();await stopped;
 assert.equal((await presence()).online,true,"another visible device keeps presence online");
 const offlineEvent=wait(b,"presence.changed",data=>data.userId===fixtures.users[0].id);otherDevice.emit("presence.heartbeat",{visible:false});await offlineEvent;const offline=await presence();assert.equal(offline.online,false);assert.ok(offline.lastSeenAt);
 assert.equal(leaked,false,"non-member admin must not receive activity");
 let unauthorized=false;b.on("chat.activity",d=>{if(d.userId===third)unauthorized=true;});outsider.emit("chat.activity",{chatId:fixtures.chatId,kind:"typing"});await new Promise(r=>setTimeout(r,550));assert.equal(unauthorized,false);
 const cookie=`${fixtures.users[1].cookieName}=${fixtures.users[1].cookieValue}`;
 const history=await(await fetch(`${apiBase}/api/v1/chats/${fixtures.chatId}/messages`,{headers:{cookie}})).json() as any;
 const messageId=history.messages.at(-1).id;
 const receiptEvent=wait(b,"receipt.changed",d=>d.chatId===fixtures.chatId);
 const response=await fetch(`${apiBase}/api/v1/receipts/delivered`,{method:"POST",headers:{cookie,origin:base,"content-type":"application/json"},body:JSON.stringify({items:[{chatId:fixtures.chatId,messageId}]})});assert.equal(response.status,200);await receiptEvent;
 console.log("PASS authenticated realtime activity, disconnect, isolation, receipt fan-out and multi-device presence");
}finally{sockets.forEach(s=>s.disconnect());await pool.end();}
