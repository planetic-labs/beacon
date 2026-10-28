// Real IndexedDB in Chromium; synthetic API data, no deployment users or sessions.
import {chromium,expect} from "@playwright/test";
import {createServer} from "../apps/web/node_modules/vite/dist/node/index.js";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url));
const server=await createServer({root,configFile:`${root}/vite.config.ts`,server:{host:"127.0.0.1",port:0}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==="string")throw new Error("No test server");
const base=`http://127.0.0.1:${address.port}`,id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,"0")}`;
const me={id:id(1),name:"Тестовый Пользователь",firstName:"Тестовый",lastName:"Пользователь",role:"user",banned:false};
const peer={...me,id:id(2),name:"Второй Участник"};
const chats=[3,4].map(n=>({id:id(n),kind:"group",name:`Чат ${n}`,title:`Чат ${n}`,ownerId:me.id,unread:0,lastAt:`2026-01-0${n}T00:00:00Z` }));
const message=(n:number,chatId=id(3))=>({id:id(n),chatId,authorId:peer.id,authorName:peer.name,clientMessageId:id(n),type:"text",content:{text:`Сообщение ${n}`},createdAt:`2026-01-01T00:${String(Math.floor(n/60)).padStart(2,"0")}:${String(n%60).padStart(2,"0")}.000000Z`,reactions:[]});
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
try{
 const context=await browser.newContext({serviceWorkers:"block"}),page=await context.newPage(),errors:string[]=[];
 page.on("pageerror",e=>errors.push(e.message));
 let disconnected=false,expired=false,switched=false,ambiguous=true,member=true;
 const sent=new Map<string,any>(),preloads:string[]=[];
 let history=[message(10),message(11)];
 await context.route("**/socket.io/**",route=>route.abort());
 await context.route("**/api/**",async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   if(disconnected)return route.abort("internetdisconnected");
   if(expired)return route.fulfill({status:401,json:{error:"Session expired"}});
   let data:unknown=[];
   if(path==="/api/v1/me")data=switched?peer:me;
   else if(path==="/api/v1/users")data=[me,peer];
   else if(path==="/api/v1/chats")data=switched?[]:chats.filter(c=>member||c.id!==id(4));
   else if(path.endsWith("/offline")){
     const chatId=path.split("/")[4];preloads.push(chatId);
     data={messages:chatId===id(3)?history:[message(12,id(4))],hasMoreRead:false,hasMoreUnread:false};
   }else if(path.endsWith("/messages")&&request.method()==="POST"){
     const body=request.postDataJSON();sent.set(body.clientMessageId,body);
     if(ambiguous){ambiguous=false;return route.abort("connectionreset");}
     data={id:id(100)};
   }else if(path.endsWith("/messages"))data={messages:history,hasMore:false};
   else if(path.endsWith("/members"))data={members:[me,peer],chat:chats[0]};
   else if(path==="/api/v1/drafts")data=chats.filter(c=>member||c.id!==id(4)).map(c=>({chatId:c.id,draft:{text:"",mentions:[]},revision:0}));
   else if(path.endsWith("/draft"))data={chatId:path.split("/")[4],draft:request.postDataJSON(),revision:1};
   else if(path==="/api/push")data={configured:false,enabled:true,publicKey:null,mutedChatIds:[]};
   await route.fulfill({json:data});
 });
 const stats=()=>page.evaluate(async()=>{
   const {deviceStats}=await import("/src/offline.ts" as string);return deviceStats();
 });
 const localRows=()=>page.evaluate(async()=>{
   const {deviceDB}=await import("/src/offline.ts" as string);
   return {cache:await deviceDB.cache.toArray(),drafts:await deviceDB.drafts.toArray(),outbox:await deviceDB.outbox.toArray(),reads:await deviceDB.reads.toArray()};
 });
 const composer=()=>page.getByRole("textbox",{name:"Сообщение",exact:true});
 await page.goto(`${base}/chats/${id(3)}`);
 await expect(composer()).toBeVisible();
 await expect.poll(async()=>(await stats()).chats).toBe(2);
 assert.equal(preloads[0],id(3),"Open chat has background priority");
 // Persisted history opens immediately while the network is stalled, not after a timeout.
 disconnected=true;
 await composer().fill("Черновик без интернета");
 await expect.poll(async()=>(await stats()).drafts).toBe(1);
 await page.reload();
 await expect(composer()).toHaveValue("Черновик без интернета");
 await expect(page.getByText("Сообщение 10",{exact:true})).toBeVisible();
 await page.goto(`${base}/chats/${id(4)}`);
 await expect(page.getByText("Сообщение 12",{exact:true})).toBeVisible();
 // Queue persists a full reload and an ambiguous first server acknowledgement.
 await composer().fill("Устойчивая очередь");await composer().press("Enter");
 await expect.poll(async()=>(await stats()).queued).toBe(1);
 await page.reload();await expect(page.getByText("Устойчивая очередь",{exact:true})).toBeVisible();
 await composer().fill("Оставить этот черновик");
 await expect.poll(async()=>(await stats()).drafts).toBe(2);
 await expect.poll(async()=>(await localRows()).reads.length).toBeGreaterThan(0);
 await page.goto(`${base}/settings/data`);
 await expect(page.getByRole("heading",{name:"Данные на устройстве",exact:true,level:1})).toBeVisible();
 for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:900});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`device data ${width}px`);
 }
 await page.setViewportSize({width:1280,height:900});
 await page.getByRole("button",{name:"Очистить загруженную переписку",exact:true}).click();
 await expect.poll(async()=>(await stats()).messages).toBe(0);
 assert.equal((await stats()).queued,1);assert.equal((await stats()).drafts,2);
 disconnected=false;
 await page.evaluate(()=>dispatchEvent(new Event("online")));
 await expect.poll(()=>sent.size,{timeout:20000}).toBe(1);
 await expect.poll(async()=>(await stats()).queued,{timeout:35000}).toBe(0);
 assert.equal(sent.size,1,"Retry reuses the same clientMessageId");
 await expect.poll(async()=>(await localRows()).reads.length).toBe(0);
 await page.getByRole("button",{name:"Возобновить фоновую загрузку",exact:true}).click();
 await expect.poll(async()=>(await stats()).chats).toBe(2);
 // Replacing a window reconciles mutations of older cached messages, not only arrivals.
 history=[{...message(10),content:{text:"Исправлено на сервере"}},{...message(11),type:"deleted",content:{text:""}}];
 await page.evaluate(()=>dispatchEvent(new Event("online")));
 await expect.poll(async()=>JSON.stringify((await localRows()).cache)).toContain("Исправлено на сервере");
 const cache=(await localRows()).cache.find((row:any)=>row.key.endsWith(`history/${id(3)}`));
 assert.equal(cache.value.messages[1].type,"deleted");
 member=false;await page.evaluate(()=>dispatchEvent(new Event("online")));
 await expect.poll(async()=>(await stats()).chats).toBe(1);
 assert.ok(!(await localRows()).drafts.some((row:any)=>row.chatId===id(4)),"Revoked membership purges drafts too");
 switched=true;
 await page.reload();
 await expect.poll(async()=>JSON.stringify(await localRows())).not.toContain("Черновик без интернета");
 assert.ok((await localRows()).cache.every((row:any)=>row.account===peer.id));
 await page.goto(`${base}/settings/profile`);
 await page.getByRole("button",{name:"Выйти из аккаунта",exact:true}).click();
 await expect(page.locator("#email")).toBeVisible();
 assert.deepEqual(await localRows(),{cache:[],drafts:[],outbox:[],reads:[]});
 expired=true;await page.reload();await expect(page.locator("#email")).toBeVisible();
 assert.deepEqual(await localRows(),{cache:[],drafts:[],outbox:[],reads:[]});
 expired=false;switched=false;member=true;
 await page.reload();await page.goto(`${base}/chats/${id(3)}`);await expect(composer()).toBeVisible();
 await page.evaluate(async()=>{const {deviceDB}=await import("/src/offline.ts" as string);deviceDB.outbox.put=()=>Promise.reject(new DOMException("Quota exceeded","QuotaExceededError"));});
 await composer().fill("Не терять при ошибке диска");await page.getByRole("button",{name:"Отправить сообщение",exact:true}).click();
 await expect(composer()).toHaveValue("Не терять при ошибке диска");
 await expect(page.getByRole("alert")).toContainText("Сообщение не сохранено. Текст оставлен в поле ввода.");
 assert.equal((await stats()).queued,0);
 assert.deepEqual(errors,[]);
 await context.close();
 console.log("PASS offline history, all-chat preload, durable drafts/queue, deduplication, cache clear, mutations, membership/account/session isolation");
}finally{await browser.close();await server.close();}
