import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {subscriptionInput} from "../apps/api/src/modules/push/config";
import {createECDH,randomBytes} from "node:crypto";

test("push endpoints cannot address private services or unrelated hosts",()=>{
  const ecdh=createECDH("prime256v1");ecdh.generateKeys();
  const keys={p256dh:ecdh.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url")};
  for(const host of ["fcm.googleapis.com","web.push.apple.com","updates.push.services.mozilla.com","wns2.notify.windows.com"])
    assert.ok(subscriptionInput.safeParse({endpoint:`https://${host}/test`,keys}).success);
  for(const endpoint of ["https://localhost/test","https://127.0.0.1/test","http://fcm.googleapis.com/test","https://fcm.googleapis.com.attacker.example/test","https://user:password@fcm.googleapis.com/test","https://fcm.googleapis.com:8443/test"])
    assert.equal(subscriptionInput.safeParse({endpoint,keys}).success,false);
  assert.equal(subscriptionInput.safeParse({endpoint:"https://fcm.googleapis.com/test",keys:{...keys,p256dh:"A".repeat(87)}}).success,false);
});

test("service worker displays only freshly authorized messages and opens their chat",async()=>{
  const handlers:Record<string,(event:any)=>void>={};
  const notifications:any[]=[],opened:any[]=[];
  let authorized=true,requests=0;
  const chatId="019a0000-0000-7000-8000-000000000001";
  const client={url:"https://beacon.example.com/",focus:async()=>{},postMessage:(data:any)=>opened.push(data)};
  const self={location:{origin:"https://beacon.example.com"},addEventListener:(name:string,fn:any)=>{handlers[name]=fn},
    clients:{matchAll:async()=>[client],openWindow:async(url:string)=>opened.push(url)},
    registration:{showNotification:async(title:string,options:any)=>{notifications.push({title,...options})}}};
  runInNewContext(await readFile("apps/web/public/sw.js","utf8"),{self,URL,URLSearchParams,fetch:async()=>{
    requests++;return Response.json(authorized?{title:"Beacon",body:"Новое сообщение",chatId}:null);
  }});
  async function dispatch(name:string,data:any){let work:Promise<unknown>|undefined;handlers[name]({...data,waitUntil:(p:Promise<unknown>)=>{work=p}});await work;}
  const payload={type:"message",subscriptionId:chatId,messageId:chatId,chatId};
  await dispatch("push",{data:{json:()=>payload}});
  assert.equal(notifications.length,1);assert.equal(notifications[0].tag,`beacon-chat-${chatId}`);
  authorized=false;
  await dispatch("push",{data:{json:()=>payload}});assert.equal(notifications.length,1);
  await dispatch("push",{data:{json:()=>({...payload,chatId:"https://attacker.example/"})}});
  assert.equal(requests,2);
  await dispatch("notificationclick",{notification:{data:{chatId},close:()=>{}}});
  assert.equal(opened[0].type,"beacon:open-chat");assert.equal(opened[0].chatId,chatId);
  let intercepted=false;
  handlers.fetch({request:{method:"GET",url:"https://beacon.example.com/api/v1/chats",mode:"cors"},respondWith:()=>{intercepted=true}});
  assert.equal(intercepted,false,"private APIs must never enter the offline cache");
  handlers.fetch({request:{method:"GET",url:"https://beacon.example.com/api/auth/oauth2/authorize",mode:"navigate"},respondWith:()=>{intercepted=true}});
  assert.equal(intercepted,false,"OIDC redirects must remain ordinary browser navigations");
});
