import { messageAction, openMessageMenu } from "./message-menu";
// Layout and status checks use synthetic accounts and never touch dev messages.
import {chromium,expect} from "@playwright/test";
import {createServer} from "../apps/web/node_modules/vite/dist/node/index.js";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url));
const server=await createServer({root,configFile:`${root}/vite.config.ts`,server:{host:"127.0.0.1",port:0}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==="string")throw new Error("Vite not started");
const id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,"0")}`,chatId=id(3),base=`http://127.0.0.1:${address.port}`;
const me={id:id(1),name:"Тестовый Отправитель С Длинной Фамилией",firstName:"Тестовый",lastName:"Отправитель",role:"user",banned:false};
const peer={...me,id:id(2),name:"Другой Участник",firstName:"Другой",lastName:"Участник"};
const time=(minute:number)=>new Date(Date.UTC(2026,0,1,12,minute)).toISOString();
const messages=Array.from({length:300},(_,n)=>n).map(n=>({id:id(10+n),chatId,authorId:n?me.id:peer.id,authorName:n?me.name:peer.name,type:"text",content:{text:`Сообщение ${n}`},createdAt:time(n),clientMessageId:id(10+n),reactions:[]}));
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
try{
 for(const width of [390]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:"block"}),page=await context.newPage(),errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  let partial=false,identityVersion=0,identityRequests=0;
  await context.route("**/socket.io/**",route=>route.abort());
  await context.route("**/api/**",async route=>{
   const path=new URL(route.request().url()).pathname;let data:unknown=[];
   if(path==="/api/stickers")data=[{id:id(900),name:"Тестовый набор",active:true,stickers:Array.from({length:500},(_,n)=>({id:id(1000+n),fileId:id(2000+n),label:`Стикер ${n}`,emojis:["👋"],keywords:["привет"]}))}];
   else if(path==="/api/v1/me"){identityRequests++;data={...me,name:identityVersion?"Обновлённое имя":me.name};}
   else if(path==="/api/v1/users")data=[me,peer];
   else if(path==="/api/v1/chats")data=[{id:chatId,kind:"group",name:"Тестовый чат",title:"Тестовый чат",ownerId:me.id,unread:0}];
   else if(path.endsWith("/messages"))data={messages,hasMore:false};
   else if(path.endsWith("/receipts"))data=[{userId:peer.id,name:peer.name,joinedAt:time(0),deliveredAt:time(2),readAt:time(1)},...(partial?[{userId:id(99),name:"Третий участник",joinedAt:time(0),deliveredAt:time(0),readAt:time(0)}]:[])];
   else if(path.endsWith("/members"))data={members:[me,peer],chat:{id:chatId,kind:"group"}};
   else if(path==="/api/push")data={configured:false,enabled:true,publicKey:null,mutedChatIds:[]};
   await route.fulfill({json:data});
  });
  await page.goto(`${base}/chats/${chatId}`);await expect(page.locator('.message-group')).toHaveCount(300);
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
  const timings=await page.evaluate(async()=>{const input=document.querySelector<HTMLTextAreaElement>('#composer')!;const result=[];for(let i=0;i<5;i++){input.blur();await new Promise(r=>setTimeout(r,50));const start=performance.now();input.focus();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));result.push(Math.round(performance.now()-start));}return result;});
  console.log('Focus to two animation frames, 300 messages, CPU x4:',timings);
  const {profile}=await cdp.send('Profiler.stop');console.log('CPU hot functions:',profile.nodes.filter(n=>n.hitCount).sort((a,b)=>(b.hitCount??0)-(a.hitCount??0)).slice(0,20).map(n=>[n.callFrame.functionName,n.hitCount,n.callFrame.url.split('/').at(-1)?.split('?')[0]]));

  const viewportTiming=await page.evaluate(async()=>{
   const viewport=window.visualViewport!;const original=Object.getOwnPropertyDescriptor(viewport,'height');
   const start=performance.now();Object.defineProperty(viewport,'height',{configurable:true,value:400});viewport.dispatchEvent(new Event('resize'));
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const height=document.querySelector('.app')!.getBoundingClientRect().height;
   if(original)Object.defineProperty(viewport,'height',original);else Reflect.deleteProperty(viewport,'height');viewport.dispatchEvent(new Event('resize'));
   return {elapsed:Math.round(performance.now()-start),height};
  });
  assert.equal(Math.round(viewportTiming.height),400);console.log('Simulated keyboard viewport update:',viewportTiming);
  await page.evaluate("window.__name = fn => fn");
  await cdp.send("Profiler.start");
  const typing=await page.evaluate(async()=>{
   const input=document.querySelector<HTMLTextAreaElement>('#composer')!;
   const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;
   const change=(text:string)=>{setter.call(input,text);input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text.slice(-1)}));};
   const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const results=[];
   for(let i=0;i<10;i++){change('');await new Promise(r=>setTimeout(r,250));input.focus();const first=performance.now();change('п');await frame();const a=performance.now()-first;const next=performance.now();change('пр');await frame();results.push({first:Math.round(a),next:Math.round(performance.now()-next)});}
   const initial=input.getBoundingClientRect().height;change('длинный текст '.repeat(100));await frame();const grown=input.getBoundingClientRect().height;change('');await frame();
   return {samples:results,initial,grown,restored:input.getBoundingClientRect().height};
  });console.log('First and next character CPU x4:',typing);assert.ok(typing.grown>typing.initial);assert.ok(typing.restored<=typing.initial+1);
  const typingProfile=(await cdp.send('Profiler.stop')).profile;console.log('Typing CPU hot functions:',typingProfile.nodes.filter(n=>n.hitCount).sort((a,b)=>(b.hitCount??0)-(a.hitCount??0)).slice(0,20).map(n=>[n.callFrame.functionName,n.hitCount,n.callFrame.url.split('/').at(-1)?.split('?')[0]]));
  const continuous=await page.evaluate(async()=>{
    const input=document.querySelector<HTMLTextAreaElement>('#composer')!;const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;
    const text='Обычный длинный текст сообщения с несколькими словами и переносами строки. '.repeat(2);const result=[];
    for(let i=1;i<=80;i++){const start=performance.now();setter.call(input,text.slice(0,i));input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text[i-1]}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));result.push(Math.round(performance.now()-start));}
    return {worst:result.slice().sort((a,b)=>b-a).slice(0,5),over200:result.filter(ms=>ms>200).length};
  });console.log('Continuous mobile typing, 80 characters CPU x4:',continuous);
  const menuTimings=[];
  for(let i=0;i<1;i++){await page.getByRole('textbox',{name:'Сообщение',exact:true}).blur();const start=Date.now();await page.getByRole('button',{name:'Действия с чатом',exact:true}).click({timeout:10000});await expect(page.getByRole('dialog',{name:'Действия с чатом',exact:true})).toBeVisible();menuTimings.push(Date.now()-start);await page.keyboard.press('Escape');}
  console.log('Menu open incl Playwright click, CPU x4:',menuTimings);
assert.ok(identityRequests>1,'Identity checks must continue during reconnects');
 identityVersion=1;await expect(page.locator('.list-presence strong')).toHaveText('Обновлённое имя',{timeout:15000});
 console.log('PASS unchanged identity avoids history redraw; changed identity still updates UI');
assert.deepEqual(errors,[]);await context.close();
 }
}finally{await browser.close();await server.close();}
