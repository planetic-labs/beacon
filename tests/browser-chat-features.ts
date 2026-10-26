// Synthetic UI fixtures: never mutate users, sessions or messages in development.
import { chromium, expect } from "@playwright/test";
import { createServer } from "../apps/web/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url));
const server=await createServer({root,configFile:`${root}/vite.config.ts`,server:{host:"127.0.0.1",port:0}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==="string")throw new Error("Vite did not start");
const base=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
const id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,"0")}`;
const user={id:id(1),name:"Тест Один",firstName:"Тест",lastName:"Один",role:"admin",banned:false};
const peer={id:id(2),name:"Тест Два",firstName:"Тест",lastName:"Два",banned:false};
const chatId=id(3),messageId=id(4),oldId=id(5);
const makeMessage=(mid:string,text:string,author=user.id,createdAt="2026-01-02T12:00:00.123456Z")=>({id:mid,chatId,authorId:author,authorName:author===user.id?user.name:peer.name,type:"text",content:{text},createdAt,clientMessageId:mid,reactions:[]});
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"});const page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const scopes:(string|null)[]=[];
  let messages=[makeMessage(messageId,"Сообщение для проверки")];let sent:any,readRequests=0,deliveryRequests=0,searches=0,aroundRequests=0;
  await context.route("**/socket.io/**",route=>route.abort());
  await context.route("**/api/**",async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;let data:unknown={ok:true};
   if(path==="/api/v1/me")data=user;
   else if(path==="/api/v1/users")data=[user,peer];
   else if(path==="/api/v1/chats")data=[{id:chatId,name:"Тестовый чат",kind:"group",title:"Тестовый чат",ownerId:user.id,unread:0,lastMessageId:messageId}];
   else if(path.endsWith("/members"))data={members:[user,peer],chat:{id:chatId,kind:"group"}};
   else if(path.endsWith("/receipts"))data=[{userId:peer.id,name:peer.name,joinedAt:"2026-01-01T00:00:00.000000Z",deliveredAt:"2026-01-02T13:00:00.000000Z",readAt:"2026-01-02T13:00:00.000000Z"}];
   else if(path==="/api/v1/receipts/delivered")deliveryRequests++;
   else if(path.endsWith("/read"))readRequests++;
   else if(path==="/api/stickers")data=[];
   else if(path==="/api/push")data={configured:false,publicKey:null,enabled:true,showPreview:false,mutedChatIds:[]};
   else if(path==="/api/v1/search"){
    searches++;scopes.push(url.searchParams.get("chatId"));assert.equal(url.searchParams.get("query"),"пров");
    data={people:url.searchParams.has("chatId")?[]:[peer],chats:[],messages:[{id:oldId,chatId,chatName:"Тестовый чат",authorId:peer.id,authorName:peer.name,text:"Давняя проверка",createdAt:"2025-01-02T12:00:00.000000Z"}]};
   }else if(path.endsWith("/messages")){
    if(request.method()==="POST"){sent=request.postDataJSON();messages.push({...makeMessage(id(6),sent.text),content:{text:sent.text,...(sent.mentions?{mentions:sent.mentions}:{})}} as any);data={id:id(6)};}
    else if(url.searchParams.has("aroundId")){aroundRequests++;data={messages:[makeMessage(oldId,"Давняя проверка",peer.id,"2025-01-02T12:00:00.000000Z")],hasMore:true};}
    else data={messages,hasMore:false};
   }
   await route.fulfill({json:data});
  });
  await page.goto(`${base}/chats/${chatId}`);
  await expect(page.getByLabel("Прочитано",{exact:true})).toBeVisible();
  await expect.poll(()=>deliveryRequests).toBeGreaterThan(0);await expect.poll(()=>readRequests).toBeGreaterThan(0);
  const input=page.getByRole("textbox",{name:"Сообщение",exact:true});await input.fill("Привет @Тест Д");
  await page.getByRole("option",{name:peer.name,exact:true}).click();
  await expect(input).toHaveValue(`Привет @${peer.name} `);
  await page.getByRole("button",{name:"Отправить сообщение",exact:true}).click();
  await expect.poll(()=>sent?.mentions?.[0]?.userId).toBe(peer.id);assert.equal(sent.mentions[0].start,7);
  await expect(page.locator(".message-mention")).toHaveText(`@${peer.name}`);
  await page.getByRole("button",{name:"Поиск в чате",exact:true}).click();
  await expect(page.getByRole("combobox",{name:"Переписка",exact:true})).toHaveValue(chatId);
  await expect(page.getByRole("combobox",{name:"Автор",exact:true})).toHaveValue("");
  const query=page.getByRole("searchbox",{name:"Поисковый запрос"});await query.fill("пров");
  await page.getByRole("button",{name:/Давняя проверка/}).click();
  await expect(page.locator(`#message-${oldId}`)).toBeVisible();assert.equal(aroundRequests,1);
  await expect(page.getByRole("button",{name:"К новым сообщениям"})).toBeVisible();
  if(width===390){await page.getByRole("button",{name:"Назад к списку",exact:true}).click();await expect(query).toBeVisible();}
  await expect.poll(()=>searches).toBe(1);assert.deepEqual(scopes,[chatId]);
  await page.getByRole("combobox",{name:"Переписка",exact:true}).selectOption("");
  await expect.poll(()=>searches).toBe(2);assert.deepEqual(scopes,[chatId,null]);
  assert.deepEqual(errors,[]);await expect(page.getByRole("alert")).toHaveCount(0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"no horizontal overflow");
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-chat-features-${width}.png`,fullPage:true});await context.close();console.log(`PASS chat features ${width}px`);
 }
}finally{await browser.close();await server.close();}
