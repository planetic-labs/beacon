// Real IndexedDB and synthetic chats: no deployment accounts or history are changed.
import {chromium,expect} from "@playwright/test";
import {createServer} from "../apps/web/node_modules/vite/dist/node/index.js";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url));
const server=await createServer({root,configFile:`${root}/vite.config.ts`,server:{host:"127.0.0.1",port:0}});await server.listen();
const address=server.httpServer!.address();assert.ok(address&&typeof address!=="string");
const base=`http://127.0.0.1:${address.port}`,id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,"0")}`;
const me={id:id(1),name:"Тестовый Пользователь",firstName:"Тестовый",lastName:"Пользователь",role:"user",banned:false};
const chats=[3,4].map(n=>({id:id(n),kind:"group",name:`Чат ${n}`,title:`Чат ${n}`,ownerId:me.id,unread:0}));
const history=(chatId:string)=>Array.from({length:80},(_,n)=>({id:id(Number(chatId.slice(-3))*100+n),chatId,authorId:id(2),authorName:"Другой Участник",clientMessageId:id(1000+n),type:"text",content:{text:`Сообщение ${n+1} · достаточно длинный текст для переписки на мобильном устройстве`},createdAt:new Date(Date.UTC(2026,0,1,0,n)).toISOString(),reactions:[]}));
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:800},serviceWorkers:"block"}),page=await context.newPage(),errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  let offline=false,stall=false,release:(()=>void)|undefined;
  await context.route("**/socket.io/**",route=>route.abort());
  await context.route("**/api/**",async route=>{
    if(offline)return route.abort("internetdisconnected");
    const url=new URL(route.request().url()),path=url.pathname;
    if(stall&&path.endsWith("/messages"))await new Promise<void>(resolve=>{release=resolve;});
    let data:unknown=[];
    const chatId=path.split("/")[4],messages=history(chatId??chats[0].id);
    if(path==="/api/v1/me")data=me;
    else if(path==="/api/v1/chats")data=chats;
    else if(path==="/api/v1/users")data=[me];
    else if(path.endsWith("/offline"))data={messages,hasMoreRead:false,hasMoreUnread:false};
    else if(path.endsWith("/messages"))data={messages,hasMore:false};
    else if(path.endsWith("/members"))data={members:[me],chat:chats.find(c=>c.id===chatId)};
    else if(path==="/api/push")data={configured:false,enabled:true,publicKey:null,mutedChatIds:[]};
    await route.fulfill({json:data}).catch(()=>{});
  });
  const bottom=()=>page.locator(".feed").evaluate(node=>node.scrollHeight-node.scrollTop-node.clientHeight);
  await page.goto(`${base}/chats/${id(3)}`);
  await expect(page.locator(".feed .message-group")).toHaveCount(80);
  await expect.poll(bottom).toBeLessThan(3);
  await expect.poll(()=>page.evaluate(async()=>{const {deviceStats}=await import("/src/offline.ts" as string);return(await deviceStats()).chats;})).toBe(2);
  if(width>780){
    const composer=page.getByRole("textbox",{name:"Сообщение",exact:true});
    await composer.fill("Черновик при повторном выборе");
    await page.locator(".feed").evaluate(node=>{node.scrollTop=100;});
    for(let click=0;click<2;click++)await page.locator(".chat-list").getByRole("button",{name:/Чат 3/}).click();
    await expect(page.locator(".feed .message-group")).toHaveCount(80);
    await expect(page.locator(".feed")).toHaveJSProperty("scrollTop",100);
    await expect(composer).toHaveValue("Черновик при повторном выборе");
  }
  // Cache-first opening must scroll even while the foreground network request is stalled.
  stall=true;
  await page.reload();
  await expect(page.locator(".feed .message-group")).toHaveCount(80);
  await expect.poll(bottom).toBeLessThan(3);
  // A later response must not drag someone away from the older messages they are reading.
  await page.locator(".feed").evaluate(node=>{node.scrollTop=0;});
  stall=false;release?.();
  await page.waitForTimeout(150); // Let the previous delayed scroll callback, if any, run.
  await expect(page.locator(".feed")).toHaveJSProperty("scrollTop",0);
  offline=true;
  await page.goto(`${base}/chats/${id(4)}`);
  await expect(page.locator(".feed .message-group")).toHaveCount(80);
  await expect.poll(bottom).toBeLessThan(3);
  await page.goto(`${base}/chats/${id(3)}`);
  await expect(page.locator(".feed .message-group")).toHaveCount(80);
  await expect.poll(bottom).toBeLessThan(3);
  if(width<780)await page.getByRole("button",{name:"Назад к списку",exact:true}).click();
  const navigation=width>780?page.locator(".nav-rail"):page.getByRole("navigation",{name:"Навигация",exact:true});
  if(width<=780){await navigation.getByRole("button",{name:"Ещё",exact:true}).click();await page.locator(".more-links").getByRole("button",{name:"Настройки",exact:true}).click();}else await navigation.getByRole("button",{name:"Настройки",exact:true}).click();
  await page.getByRole("navigation",{name:"Разделы настроек",exact:true}).getByRole("button",{name:"Данные на устройстве",exact:true}).click();
  if(width<780){await page.getByRole("button",{name:"Назад к разделам",exact:true}).click();await page.getByRole("button",{name:"Назад в Ещё",exact:true}).click();await navigation.getByRole("button",{name:"Чаты",exact:true}).click();}
  else await navigation.getByRole("button",{name:"Чаты",exact:true}).click();
  await page.locator(".chat-list").getByRole("button",{name:/Чат 3/}).click();
  await expect(page.locator(".feed .message-group")).toHaveCount(80);
  await expect.poll(bottom).toBeLessThan(3);
  // The newest unread incoming message can precede the user's later outgoing messages.
  offline=false;
  chats[1].unread=5;
  Object.assign(chats[1],{lastUnreadMessageId:id(459)});
  await context.unroute("**/api/**");
  await context.route("**/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    const messages=history(id(4)).map((message,n)=>n>=60?{...message,authorId:me.id,authorName:me.name}:message);
    let data:unknown=[];
    if(path==="/api/v1/me")data=me;
    else if(path==="/api/v1/chats")data=chats;
    else if(path==="/api/v1/users")data=[me];
    else if(path.endsWith("/messages"))data={messages,hasMore:false};
    else if(path.endsWith("/offline"))data={messages,hasMoreRead:false,hasMoreUnread:false};
    else if(path.endsWith("/members"))data={members:[me],chat:chats[1]};
    else if(path==="/api/push")data={configured:false,enabled:true,publicKey:null,mutedChatIds:[]};
    await route.fulfill({json:data});
  });
  // The cached chat list still says all-read; fresh metadata must correct the initial position.
  await page.goto(`${base}/chats/${id(4)}`);
  await expect(page.locator(`#message-${id(459)}`)).toBeInViewport();
  await expect.poll(bottom).toBeGreaterThan(300);
  await page.waitForTimeout(150);
  await expect(page.locator(`#message-${id(459)}`)).toBeInViewport();
  // Subsequent offline opening uses the same unread position from the local snapshot.
  await context.unroute("**/api/**");await context.route("**/api/**",route=>route.abort("internetdisconnected"));
  await page.reload();await expect(page.locator(`#message-${id(459)}`)).toBeInViewport();
  await expect.poll(bottom).toBeGreaterThan(300);
  chats[1].unread=0;delete (chats[1] as {lastUnreadMessageId?:string}).lastUnreadMessageId;
  assert.deepEqual(errors,[]);await context.close();
  console.log(`PASS latest-message opening, cached/stalled/offline history and chat switching ${width}px`);
 }
}finally{await browser.close();await server.close();}
