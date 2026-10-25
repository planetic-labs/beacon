import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import webpush from "web-push";
import { db } from "../src/db";
import { auth } from "../src/modules/auth/config";
import { subscribe } from "../src/modules/push/service";
import { deliverPushBatch } from "../src/modules/push/worker";
import { GET,POST,PATCH,DELETE } from "../src/app/api/push/[[...path]]/route";

export async function pushScenarios(ids:string[],cookies:string[],chatId:string,groupId:string,
  call:(path:string,method?:string,body?:unknown,cookie?:string)=>Promise<Response>) {
  const keys=webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY=keys.publicKey;process.env.VAPID_PRIVATE_KEY=keys.privateKey;
  const base=process.env.APP_URL!;
  const request=async(path:string,method="GET",data?:unknown,cookie=cookies[2],origin=base)=>{
    const q=path.indexOf("?");
    const parts=(q<0?path:path.slice(0,q)).split("/").filter(Boolean);
    return ({GET,POST,PATCH,DELETE} as Record<string,typeof GET>)[method](new Request(`${base}/api/push${path}`,{
      method,headers:{cookie,origin,"content-type":"application/json"},...(data?{body:JSON.stringify(data)}:{})
    }),{params:Promise.resolve({path:parts})});
  };
  const input=()=>{
    const ecdh=createECDH("prime256v1");ecdh.generateKeys();
    return {endpoint:`https://fcm.googleapis.com/fcm/send/${v7()}`,
      keys:{p256dh:ecdh.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url")}};
  };
  const a=input(),b=input();
  assert.equal((await request("/subscriptions","POST",{...a,endpoint:"https://127.0.0.1/private"})).status,400);
  assert.equal((await request("/subscriptions","POST",a,cookies[2],"https://unrelated.example.com")).status,403);
  const sub1=await (await request("/subscriptions","POST",a)).json();
  const sub2=await (await request("/subscriptions","POST",b)).json();
  assert.ok(sub1.id&&sub2.id);
  assert.equal((await request("/subscriptions","POST",a,cookies[1])).status,409);
  await request("/subscriptions","DELETE",{endpoint:a.endpoint},cookies[1]);
  assert.equal((await db.execute(sql`select id from push_subscription where id=${sub1.id}`)).rowCount,1);
  await request("/subscriptions","POST",input(),cookies[0]);
  await request("/subscriptions","POST",input(),cookies[1]);
  const send=async(chat=chatId)=>{
    const clientMessageId=v7();
    const data={clientMessageId,text:"Private push message"};
    const first=await call(`chats/${chat}/messages`,"POST",data,cookies[1]);
    assert.equal(first.status,200);
    const message=await first.json();
    await call(`chats/${chat}/messages`,"POST",data,cookies[1]);
    return message.id as string;
  };
  const jobs=async(message:string)=>(await db.execute(sql`select * from push_delivery where message_id=${message}`)).rows;
  const due=async()=>{await db.execute(sql`update push_delivery set next_attempt_at=now() where completed_at is null`)};
  const delivered:string[]=[];
  const transport=async(_sub:unknown,payload:string)=>{delivered.push(payload)};
  const first=await send();
  assert.equal((await jobs(first)).length,2,"only recipient devices; replay must not enqueue duplicates");
  let view=await (await request(`/notification?messageId=${first}&subscriptionId=${sub1.id}`)).json();
  assert.equal(view.title,"Beacon");assert.ok(!view.body.includes("Private"));
  assert.equal(await (await request(`/notification?messageId=${first}&subscriptionId=${sub1.id}`,"GET",undefined,cookies[1])).json(),null);
  await request("","PATCH",{enabled:true,showPreview:true});
  view=await (await request(`/notification?messageId=${first}&subscriptionId=${sub1.id}`)).json();
  assert.ok(view.body.includes("Private push message"));
  await due();await Promise.all([deliverPushBatch(transport),deliverPushBatch(transport)]);
  assert.equal(delivered.length,2,"concurrent workers must claim disjoint jobs");
  assert.ok(delivered.every(p=>!p.includes("Private")&&!p.includes(a.endpoint)));
  await deliverPushBatch(transport);assert.equal(delivered.length,2);
  await request(`/chats/${chatId}`,"PATCH",{muted:true});
  assert.equal((await jobs(await send())).length,0);
  await request(`/chats/${chatId}`,"PATCH",{muted:false});
  await request("","PATCH",{enabled:false,showPreview:false});
  assert.equal((await jobs(await send())).length,0);
  await request("","PATCH",{enabled:true,showPreview:false});
  const read=await send();
  await call(`chats/${chatId}/read`,"POST",{messageId:read},cookies[2]);
  await due();await deliverPushBatch(transport);
  assert.ok((await jobs(read)).every(j=>j.outcome==="skipped"));
  const removed=await send(groupId);
  await call(`chats/${groupId}`,"PATCH",{remove:ids[2]},cookies[1]);
  await due();await deliverPushBatch(transport);
  assert.ok((await jobs(removed)).every(j=>j.outcome==="skipped"));
  await call(`chats/${groupId}`,"PATCH",{add:ids[2]},cookies[1]);
  const retry=await send();
  await due();await deliverPushBatch(async()=>{throw {statusCode:503}});
  assert.ok((await jobs(retry)).every(j=>j.outcome==="retry"&&j.attempts===1));
  await due();await deliverPushBatch(transport);
  assert.ok((await jobs(retry)).every(j=>j.outcome==="sent"&&j.attempts===2));
  const gone=await send();
  await due();await deliverPushBatch(async()=>{throw {statusCode:410}});
  assert.equal((await jobs(gone)).length,0,"expired subscriptions cascade queued jobs");
  const context=await auth.$context;
  const temporary=await context.internalAdapter.createSession(ids[2]);
  const extra=await subscribe({id:ids[2],role:"user"},temporary!.id,input());
  const loggedOut=await send();
  await db.execute(sql`delete from session where id=${temporary!.id}`);
  assert.equal((await db.execute(sql`select id from push_subscription where id=${extra.id}`)).rowCount,0);
  assert.equal((await jobs(loggedOut)).length,0);
  // Logging out a recipient concurrently must not roll back the sender's message.
  for(let i=0;i<5;i++) {
    const racing=await context.internalAdapter.createSession(ids[2]);
    await subscribe({id:ids[2],role:"user"},racing!.id,input());
    await Promise.all([send(),db.execute(sql`delete from session where id=${racing!.id}`)]);
  }
  // Leave a live subscription for the caller's final account-blocking check.
  await request("/subscriptions","POST",input());
}
