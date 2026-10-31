import {chatListAction} from "./message-menu";
import { chatAction } from "./message-menu";
import { messageAction, openMessageMenu } from "./message-menu";
// Safe synthetic UI fixtures for pins, saved notes, presence and multiple forwarding.
import { chromium, expect } from "@playwright/test";
import { createServer } from "../apps/web/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url));
const server=await createServer({root,configFile:`${root}/vite.config.ts`,server:{host:"127.0.0.1",port:0}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==="string")throw new Error("Vite did not start");
const base=`http://127.0.0.1:${address.port}`,id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,"0")}`;
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
const me={id:id(1),name:"Тест Один",firstName:"Тест",lastName:"Один",role:"user",banned:false},peer={id:id(2),name:"Тест Два",firstName:"Тест",lastName:"Два",banned:false};
const chatId=id(3),savedId=id(4);
const message=(n:number,author=peer.id)=>({id:id(n),chatId,authorId:author,authorName:author===me.id?me.name:peer.name,clientMessageId:id(n),type:"text",content:{text:`Сообщение ${n}`},createdAt:`2026-01-01T10:00:${n}.000000Z`,reactions:[],pinned:false});
try{
 for(const width of [1440,1024,800,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"}),page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const source=[message(10),message(11,me.id)];let notes:any[]=[],saved=false,batch:any[]=[];
  await context.route("**/socket.io/**",route=>route.abort());
  await context.route("**/api/**",async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;let data:unknown={ok:true};
   if(path==="/api/v1/me")data=me;
   else if(path==="/api/v1/users")data=[me,peer];
   else if(path==="/api/v1/presence")data=[{userId:peer.id,online:true,lastSeenAt:new Date().toISOString()}];
   else if(path==="/api/v1/chats/saved"){saved=true;data={id:savedId};}
   else if(path==="/api/v1/chats")data=[{id:chatId,kind:"direct",name:peer.name,peerId:peer.id,unread:0,lastAt:"2026-01-01T10:00:11.000000Z"},...(saved?[{id:savedId,kind:"saved",name:"Избранное",unread:0,ownerId:me.id}]:[])];
   else if(path.endsWith("/members"))data={members:path.includes(savedId)?[me]:[me,peer]};
   else if(path.endsWith("/receipts"))data=[];
   else if(path==="/api/push")data={configured:false,enabled:true,showPreview:false,publicKey:null,mutedChatIds:[]};
   else if(path==="/api/stickers")data=[];
   else if(req.method()==="DELETE"&&path.includes("/messages/")){notes=notes.map(m=>m.id===path.split("/").at(-1)?{...m,type:"deleted",content:{},deletedAt:new Date().toISOString()}:m);}
   else if(path.endsWith("/pin")&&req.method()==="PATCH"){const mid=path.split("/").at(-2);source.forEach(m=>{if(m.id===mid)m.pinned=req.postDataJSON().pinned;});}
   else if(path.endsWith("/pins")){const pinned=source.filter(m=>m.pinned);data={pins:pinned.map(m=>({...m,text:m.content.text,pinnedAt:m.createdAt,pinnedBy:me.id})),total:pinned.length};}
   else if(path.endsWith("/forward")){batch=req.postDataJSON().messages;assert.equal(batch.length,2);notes=batch.map((item:any)=>({...source.find(m=>m.id===item.forwardId),id:item.clientMessageId,chatId:savedId,authorId:me.id,authorName:me.name,clientMessageId:item.clientMessageId,forwardedFrom:{authorName:source.find(m=>m.id===item.forwardId)!.authorName},pinned:false}));data={ids:notes.map(m=>m.id)};}
   else if(path.endsWith("/messages")){
    if(req.method()==="POST"){const body=req.postDataJSON();notes.push({...message(20,me.id),id:body.clientMessageId,chatId:savedId,clientMessageId:body.clientMessageId,content:{text:body.text},pinned:false});data={id:body.clientMessageId};}
    else data={messages:path.includes(savedId)?notes:source,hasMore:false};
   }
   await route.fulfill({json:data});
  });
  await page.goto(`${base}/chats/${chatId}`);await expect(page.locator(".chat-header-subtitle")).toHaveText("В сети");
  await expect(page.locator('.message-group .author').first()).toBeHidden();
  const incoming=await page.locator(`#message-${id(10)} .group-body`).boundingBox(),outgoing=await page.locator(`#message-${id(11)} .group-body`).boundingBox();assert.ok(incoming&&outgoing&&outgoing.x>incoming.x,'Personal bubbles align to opposite sides');
  const inputBox=await page.locator('.composer-input').boundingBox(),micBox=await page.getByRole('button',{name:'Записать голосовое сообщение',exact:true}).boundingBox();
  assert.ok(inputBox&&micBox&&Math.abs(inputBox.y+inputBox.height/2-micBox.y-micBox.height/2)<2,'Single-line text and actions share a vertical center');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-direct-floating-${width}.png`});

  await messageAction(page, page.locator(`#message-${id(10)}`), "Закрепить сообщение");await expect(page.locator(".pinned-strip")).toContainText("Сообщение 10");
  const pinBounds=await page.locator(".pinned-strip").boundingBox(),headerBounds=await page.locator(".chat-header").boundingBox();
  assert.ok(pinBounds&&headerBounds&&pinBounds.y-headerBounds.y-headerBounds.height<20,"pinned card stays next to header");
  await page.getByRole("button",{name:"Все закреплённые сообщения"}).click();await expect(page.getByRole("dialog")).toContainText("Сообщение 10");await page.getByRole("dialog").getByRole("button",{name:"Открепить",exact:true}).click();await expect(page.locator(".pinned-strip")).toHaveCount(0);await openMessageMenu(page,page.locator(`#message-${id(10)}`));await expect(page.getByRole("menuitem",{name:"Закрепить сообщение",exact:true})).toBeVisible();await page.keyboard.press("Escape");
  await chatAction(page,"Выбрать сообщения");await page.getByRole("checkbox").nth(0).check();await page.getByRole("checkbox").nth(1).check();await expect(page.locator(".selection-toolbar")).toContainText("Выбрано: 2");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"selection layout has no horizontal overflow");await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-community-selection-${width}.png`});
  await page.locator(".selection-actions").getByRole("button",{name:"Переслать",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Избранное",exact:true}).click();await expect.poll(()=>batch.length).toBe(2);
  if(width<780)await page.getByRole("button",{name:"Назад к списку",exact:true}).click();
  await chatListAction(page,"Избранное");await expect(page.locator(".chat-header-title")).toHaveText("Избранное");await expect(page.locator(".chat-rows").getByRole("button",{name:"Избранное",exact:true})).toHaveCount(0);await expect(page.locator(".forwarded")).toHaveCount(2);await expect(page.locator(".delivery-status")).toHaveCount(0);
  await page.getByLabel("Сообщение",{exact:true}).fill("Личная заметка");await page.getByRole("button",{name:"Отправить сообщение",exact:true}).click();await expect(page.locator(".bubble-text",{hasText:"Личная заметка"})).toBeVisible();
  await page.getByLabel("Сообщение",{exact:true}).fill("Несохранённый черновик");
  await messageAction(page,page.locator(".message-group").last(),"Выбрать это сообщение");
  await expect(page.locator(".composer-input")).toHaveCount(0);
  await expect(page.locator(".selection-actions").getByRole("button",{name:"Ответить",exact:true})).toBeEnabled();
  await page.getByRole("checkbox").first().check();
  await expect(page.locator(".selection-actions").getByRole("button",{name:"Ответить",exact:true})).toBeDisabled();
  await page.locator(".selection-actions").getByRole("button",{name:"Удалить",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("у всех участников");
  await page.getByRole("dialog").getByRole("button",{name:"Удалить",exact:true}).click();
  await expect(page.locator(".message-group")).toHaveCount(1);
  await expect(page.getByLabel("Сообщение",{exact:true})).toHaveValue("Несохранённый черновик");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"no horizontal overflow");assert.deepEqual(errors,[]);await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-community-${width}.png`});await context.close();console.log(`PASS saved, pins, presence and multi-forward UI ${width}px`);
 }
}finally{await browser.close();await server.close();}
