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
  const credentialed=new URL("https://fcm.googleapis.com/test");credentialed.username="test-user";credentialed.password="test-only";
  for(const endpoint of ["https://localhost/test","https://127.0.0.1/test","http://fcm.googleapis.com/test","https://fcm.googleapis.com.attacker.example/test",credentialed.href,"https://fcm.googleapis.com:8443/test"])
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
  for(const path of ["/settings","/settings/profile","/settings/security","/settings/notifications","/settings/about","/settings/stickers","/settings/data"]){
    client.url=`https://beacon.example.com${path}`;
    await dispatch("notificationclick",{notification:{data:{chatId},close:()=>{}}});
    assert.equal(opened.at(-1).type,"beacon:open-chat","reuse an existing settings window");
  }
  let intercepted=false;
  handlers.fetch({request:{method:"GET",url:"https://beacon.example.com/api/v1/chats",mode:"cors"},respondWith:()=>{intercepted=true}});
  assert.equal(intercepted,false,"private APIs must never enter the offline cache");
  handlers.fetch({request:{method:"GET",url:"https://beacon.example.com/api/auth/oauth2/authorize",mode:"navigate"},respondWith:()=>{intercepted=true}});
  assert.equal(intercepted,false,"OIDC redirects must remain ordinary browser navigations");
});

test('call push wakes a closed PWA, rechecks state and clears invitations accepted elsewhere',async()=>{
 const handlers:Record<string,(event:any)=>void>={},shown:any[]=[],opened:any[]=[],closed:string[]=[];
 const id='019a0000-0000-7000-8000-000000000001',chatId='019a0000-0000-7000-8000-000000000002';
 let active=true,authorized=true,windows:any[]=[];
 const self={location:{origin:'https://beacon.example.com'},addEventListener:(name:string,fn:any)=>{handlers[name]=fn;},
  clients:{matchAll:async()=>windows,openWindow:async(url:string)=>opened.push(url)},
  registration:{showNotification:async(title:string,options:any)=>shown.push({title,...options}),getNotifications:async({tag}:{tag:string})=>[{close:()=>closed.push(tag)}]}};
 runInNewContext(await readFile('apps/web/public/sw.js','utf8'),{self,URL,URLSearchParams,fetch:async()=>Response.json(authorized?{active,callId:id,chatId,title:'Beacon',body:'Входящий аудиозвонок'}:null)});
 async function dispatch(name:string,data:any){let work:Promise<unknown>|undefined;handlers[name]({...data,waitUntil:(p:Promise<unknown>)=>{work=p;}});await work;}
 const payload={type:'call',action:'invite',subscriptionId:id,callId:id,chatId};
 await dispatch('push',{data:{json:()=>payload}});assert.equal(shown.length,1);assert.equal(shown[0].tag,'beacon-call-'+id);assert.equal(shown[0].requireInteraction,true);
 const notification={data:shown[0].data,close:()=>{}};
 await dispatch('notificationclick',{notification});assert.equal(opened[0],'/?chat='+chatId);
 active=false;await dispatch('push',{data:{json:()=>({...payload,action:'state'})}});assert.equal(closed.at(-1),'beacon-call-'+id);
 await dispatch('notificationclick',{notification});assert.equal(opened.length,1,'expired/answered call does not open a stale invitation');
 active=true;windows=[{focused:true,visibilityState:'visible',postMessage:(m:any)=>opened.push(m)}];
 await dispatch('push',{data:{json:()=>payload}});assert.equal(shown.length,1,'focused app receives the in-app invitation instead');assert.equal(opened.at(-1).type,'beacon:calls-changed');
 authorized=false;windows=[];await dispatch('push',{data:{json:()=>payload}});assert.equal(shown.length,1,'logout or another account cannot expose call details');
});
