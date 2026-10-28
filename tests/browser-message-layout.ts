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
const time=(minute:number)=>`2026-01-01T12:0${minute}:00.000000Z`;
const messages=[0,1,2,3].map(n=>({id:id(10+n),chatId,authorId:n?me.id:peer.id,authorName:n?me.name:peer.name,type:"text",content:{text:`Сообщение ${n}`},createdAt:time(n),clientMessageId:id(10+n),reactions:[]}));
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:"block"}),page=await context.newPage(),errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  let partial=false;
  await context.route("**/socket.io/**",route=>route.abort());
  await context.route("**/api/**",async route=>{
   const path=new URL(route.request().url()).pathname;let data:unknown=[];
   if(path==="/api/v1/me")data=me;
   else if(path==="/api/v1/users")data=[me,peer];
   else if(path==="/api/v1/chats")data=[{id:chatId,kind:"group",name:"Тестовый чат",title:"Тестовый чат",ownerId:me.id,unread:0}];
   else if(path.endsWith("/messages"))data={messages,hasMore:false};
   else if(path.endsWith("/receipts"))data=[{userId:peer.id,name:peer.name,joinedAt:time(0),deliveredAt:time(2),readAt:time(1)},...(partial?[{userId:id(99),name:"Третий участник",joinedAt:time(0),deliveredAt:time(0),readAt:time(0)}]:[])];
   else if(path.endsWith("/members"))data={members:[me,peer],chat:{id:chatId,kind:"group"}};
   else if(path==="/api/push")data={configured:false,enabled:true,publicKey:null,mutedChatIds:[]};
   await route.fulfill({json:data});
  });
  await page.goto(`${base}/chats/${chatId}`);
  await expect(page.locator(".message-group .message-avatar")).toHaveCount(4);
  const read=page.locator(`#message-${id(11)}`),delivered=page.locator(`#message-${id(12)}`),sent=page.locator(`#message-${id(13)}`);
  await expect(read.getByRole("button",{name:"Прочитано",exact:true})).toHaveAttribute("data-state","read");
  await expect(delivered.getByRole("button",{name:"Доставлено",exact:true})).toHaveAttribute("data-state","delivered");
  await expect(sent.locator(".delivery-status")).toHaveCount(0);
  await expect(delivered.locator(".delivery-status svg")).toHaveClass(/lucide-check(?:\s|$)/);
  await expect(read.locator(".delivery-status svg")).toHaveClass(/lucide-check-check/);
  assert.notEqual(await read.locator(".delivery-status").evaluate(node=>getComputedStyle(node).color),await delivered.locator(".delivery-status").evaluate(node=>getComputedStyle(node).color));
  for(const message of messages){
   const row=page.locator(`#message-${message.id}`);
   await expect(row.locator(".author")).toHaveText(message.authorName);
   const avatar=await row.locator(".message-avatar").boundingBox(),author=await row.locator(".author").boundingBox(),meta=await row.locator(".message-meta").boundingBox(),bubble=await row.locator(".bubble").boundingBox();
   assert.ok(avatar&&author&&meta&&bubble);assert.ok(Math.abs(avatar.y-author.y)<=2);assert.ok(Math.abs(meta.y-author.y)<=2);
   assert.ok(meta.x>=author.x+author.width-1);assert.ok(bubble.y>=author.y+author.height);
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-message-heading-${width}.png`});
  await sent.getByRole("button",{name:"Выбрать это сообщение",exact:true}).click();
  const selectedRow=sent.locator(".message-group");await expect(selectedRow).toHaveClass(/selectable-message/);
  const checkbox=await selectedRow.locator(".message-selection").boundingBox(),avatar=await selectedRow.locator(".message-avatar").boundingBox(),author=await selectedRow.locator(".author").boundingBox();
  assert.ok(checkbox&&avatar&&author);assert.ok(checkbox.x+checkbox.width<=avatar.x);assert.ok(avatar.x+avatar.width<=author.x);
  partial=true;await page.reload();
  await expect(read.getByRole("button",{name:"Прочитано 1 из 2",exact:true})).toHaveAttribute("data-state","delivered");
  await context.close();console.log(`PASS sender header, avatars, selection and delivery icons ${width}px`);
 }
}finally{await browser.close();await server.close();}
