import {messageAction} from "./message-menu";
// Synthetic API, isolated browser storage and no development accounts.
import {chromium,expect,type Page,type CDPSession} from "@playwright/test";
import {createServer} from "../apps/web/node_modules/vite/dist/node/index.js";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url)),server=await createServer({root,configFile:root+"vite.config.ts",server:{host:"127.0.0.1",port:0}});await server.listen();
const base=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`,id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,"0")}`;
const me={id:id(1),name:"Тест Один",firstName:"Тест",lastName:"Один",role:"user",banned:false},peer={...me,id:id(2),name:"Тест Два",image:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#3158d5"/></svg>')};
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
try{for(const width of [1440,390,320]){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"}),page=await context.newPage(),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 const cdp=await context.newCDPSession(page);if(width<780)await cdp.send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:1});
 const chats=[{id:id(3),kind:"direct",name:peer.name,peerId:peer.id,avatar:peer.image,lastAt:"2026-01-01T12:00:00Z",unread:0,historyRevision:0,pinned:false,muted:false},{id:id(4),kind:"group",name:"Природа",lastAt:"2026-01-01T11:00:00Z",unread:0,historyRevision:0,pinned:false,muted:false}];
 let folders=[{id:id(5),name:"Подборка",chatIds:[id(3)]}],actions:any[]=[];
 const messages=Array.from({length:160},(_,n)=>({id:id(1000+n),chatId:id(3),authorId:n%2?me.id:peer.id,authorName:n%2?me.name:peer.name,type:"text",content:{text:`Сообщение ${n}`},createdAt:new Date(Date.UTC(2026,0,1,10,n)).toISOString(),reactions:[]}));
 const oldMessages=structuredClone(messages);
 await context.route("**/socket.io/**",r=>r.abort());
 await context.route("**/api/**",async route=>{const req=route.request(),path=new URL(req.url()).pathname;let data:unknown=[];
  if(path==="/api/v1/me")data=me;else if(path==="/api/v1/users")data=[me,peer,{...peer,id:id(7),name:"Новый Участник"}];else if(path==="/api/v1/chats"){
   if(req.method()==="POST"){chats.push({id:id(6),kind:"direct",name:"Новый Участник",peerId:id(7),avatar:"",lastAt:"",unread:0,historyRevision:0,pinned:false,muted:false});data={id:id(6)};}else data=chats;
  }else if(path==="/api/v1/chat-folders")data=folders;
  else if(path==="/api/v1/chats/selection"){
   const action=req.postDataJSON();actions.push(action);
   for(const chat of chats.filter(chat=>action.chatIds.includes(chat.id))){
    if(action.action==="pin"||action.action==="unpin")chat.pinned=action.action==="pin";
    if(action.action==="mute"||action.action==="unmute")chat.muted=action.action==="mute";
    if(action.action==="delete-own"){messages.filter(message=>message.chatId===chat.id&&message.authorId===me.id).forEach(message=>{message.type="deleted";message.content={text:"Сообщение удалено"};});chat.historyRevision++;}
   }
   if(action.action==="folder")folders=folders.map(folder=>folder.id===action.folderId?{...folder,chatIds:[...new Set([...folder.chatIds,...action.chatIds])]}:folder);data={ok:true};
  }else if(path.endsWith("/messages"))data={messages,hasMore:false,historyRevision:chats[0].historyRevision};
  else if(path.endsWith("/offline"))data={messages:messages.slice(-100),hasMoreRead:true,hasMoreUnread:false,historyRevision:chats[0].historyRevision};
  else if(path==="/api/push")data={configured:false,mutedChatIds:chats.filter(chat=>chat.muted).map(chat=>chat.id)};
  await route.fulfill({json:data});
 });
 await page.goto(base+`/chats/${id(3)}`);await expect(page.locator(".feed [data-message-id]")).toHaveCount(160);
 if(width<780)await page.getByRole("button",{name:"Назад к списку",exact:true}).click();
 const row=(name:string)=>page.locator(".chat-list").getByRole("button",{name:new RegExp(name)});
 const fresh=row("Новый Участник");
 if(width<780){const box=await fresh.boundingBox();assert.ok(box);await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:box.x+45,y:box.y+box.height/2}]});await expect(page.getByRole("toolbar",{name:"Действия с выбранными чатами"})).toBeVisible();await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});}else await fresh.click({button:"right"});
 await expect(page.getByLabel("Выбрано чатов: 1",{exact:true})).toBeVisible();await expect(fresh).toHaveAttribute("aria-pressed","true");await page.getByRole("button",{name:"Отменить выбор чатов",exact:true}).click();

 if(width<780){
  const first=row(peer.name),photo=first.locator("img.avatar"),box=await photo.boundingBox();assert.ok(box);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
  await photo.dispatchEvent("contextmenu",{bubbles:true,cancelable:true,button:2});
  await expect(page.getByLabel("Выбрано чатов: 1",{exact:true})).toBeVisible();
  await page.waitForTimeout(650);
  await expect(page.getByLabel("Выбрано чатов: 1",{exact:true})).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await page.getByRole("button",{name:"Отменить выбор чатов",exact:true}).click();
 }
 async function selectBoth(){
  const first=row(peer.name);
  if(width<780){const box=await first.boundingBox();assert.ok(box);await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:box.x+45,y:box.y+box.height/2}]});await expect(page.getByRole("toolbar",{name:"Действия с выбранными чатами"})).toBeVisible();await first.locator("img.avatar").dispatchEvent("contextmenu",{bubbles:true,cancelable:true,button:2});await expect(page.getByLabel("Выбрано чатов: 1",{exact:true})).toBeVisible();await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});}
  else{await first.focus();await page.keyboard.press("Shift+Enter");}
  await expect(page.getByLabel("Выбрано чатов: 1",{exact:true})).toBeVisible();await row("Природа").click();await expect(page.getByLabel("Выбрано чатов: 2",{exact:true})).toBeVisible();
  await expect(page.locator(".chat-selection-check")).toHaveCount(2);await expect(page.locator(".chat-list input[type=checkbox]")).toHaveCount(0);await expect(page.getByRole("tablist",{name:"Папки чатов"})).toBeVisible();
 }
 const toolbar=()=>page.getByRole("toolbar",{name:"Действия с выбранными чатами"});
 await selectBoth();await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-chat-list-selection-${width}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await toolbar().getByRole("button",{name:"Выключить уведомления",exact:true}).click();await expect(toolbar()).toHaveCount(0);assert.ok(chats.slice(0,2).every(chat=>chat.muted));
 await selectBoth();await toolbar().getByRole("button",{name:"Включить уведомления",exact:true}).click();await expect(toolbar()).toHaveCount(0);assert.ok(chats.slice(0,2).every(chat=>!chat.muted));
 await selectBoth();await toolbar().getByRole("button",{name:"Закрепить чаты",exact:true}).click();await expect(toolbar()).toHaveCount(0);assert.ok(chats.slice(0,2).every(chat=>chat.pinned));
 await selectBoth();await toolbar().getByRole("button",{name:"Открепить чаты",exact:true}).click();await expect(toolbar()).toHaveCount(0);assert.ok(chats.slice(0,2).every(chat=>!chat.pinned));
 await selectBoth();await toolbar().getByRole("button",{name:"Добавить в папку",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Подборка",exact:true}).click();await expect(toolbar()).toHaveCount(0);assert.deepEqual(new Set(folders[0].chatIds),new Set([id(3),id(4)]));
 if(width>780){await page.getByLabel("Сообщение",{exact:true}).fill("Несохранённый черновик");await messageAction(page,page.locator(`#message-${id(1159)}`),"Изменить");await expect(page.locator(".composer-context")).toBeVisible();}
 await selectBoth();await toolbar().getByRole("button",{name:"Удалить мои сообщения",exact:true}).click();await expect(page.getByRole("dialog")).toContainText("Сообщения других пользователей и сами чаты сохранятся");await page.getByRole("dialog").getByRole("button",{name:"Отмена",exact:true}).click();assert.ok(!actions.some(action=>action.action==="delete-own"));
 await toolbar().getByRole("button",{name:"Удалить мои сообщения",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Удалить мои сообщения",exact:true}).click();await expect(toolbar()).toHaveCount(0);
 if(width<780)await row(peer.name).click();
 await expect(page.locator(".feed [data-message-id]")).toHaveCount(80);if(width>780){await expect(page.locator(".composer-context")).toHaveCount(0);await expect(page.getByLabel("Сообщение",{exact:true})).toHaveValue("Несохранённый черновик");}await expect(page.locator(".bubble-text",{hasText:"Сообщение 1"}).first()).not.toHaveText("Сообщение 1");
 await page.evaluate(async({chats,oldMessages,id})=>{
  const modulePath="/src/offline.ts",offline=await import(modulePath);
  await offline.reconcileChats(chats.map((chat:any)=>({...chat,historyRevision:0})));
  await offline.writeCache(`history/${id}`,{messages:oldMessages,hasMoreRead:true,hasMoreUnread:false,historyRevision:0});
  const cached=await offline.readCache(`history/${id}`) as any;
  if(cached?.messages.some((message:any)=>message.authorId==="019a0000-0000-7000-8000-000000000001"&&message.type!=="deleted"))throw new Error("Deleted payload restored from stale snapshot");
 },{chats,oldMessages,id:id(3)});
 assert.deepEqual(errors,[]);await context.close();console.log(`PASS long press, round marks, folders, pin/mute, own-only deletion and stale offline protection ${width}px`);
}}finally{await browser.close();await server.close();}
