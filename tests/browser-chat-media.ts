import { messageAction } from "./message-menu";
import { createRequire } from "node:module";
// Synthetic users exercise media UX without touching the development deployment.
import { chromium, expect } from "@playwright/test";
import { createServer } from "../apps/web/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url));
const server=await createServer({root,configFile:`${root}/vite.config.ts`,server:{host:"127.0.0.1",port:0}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==="string")throw new Error("Vite did not start");
const base=`http://127.0.0.1:${address.port}`,id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,"0")}`;
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
const me={id:id(1),name:"Тест Один",firstName:"Тест",lastName:"Один",role:"admin",banned:false},peer={id:id(2),name:"Тест Два",firstName:"Тест",lastName:"Два",banned:false},chatId=id(3),photo1=id(4),photo2=id(5);
const sharp=createRequire(new URL("../apps/api/package.json",import.meta.url))("sharp");
const image=await sharp({create:{width:1024,height:768,channels:3,background:"#427bb0"}}).png().toBuffer();
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"}),page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const file=(n:number,mime="image/png")=>({id:id(n),mime,size:128,name:mime.startsWith("image")?undefined:"Документ.pdf"});
  const messages=[{id:photo1,chatId,authorId:me.id,authorName:me.name,type:"photo",content:{text:"Альбом",fileIds:[id(10),id(11)]},createdAt:"2026-01-01T10:00:00.000000Z",clientMessageId:photo1,reactions:[]},{id:photo2,chatId,authorId:peer.id,authorName:peer.name,type:"photo",content:{text:"Другое фото",fileIds:[id(12)]},createdAt:"2026-01-02T10:00:00.000000Z",clientMessageId:photo2,reactions:[]}];
  const opened:string[]=[];let readRequests=0;
  await context.route("**/socket.io/**",route=>route.abort());
  await context.route("**/media/**",route=>route.fulfill({contentType:"image/png",body:image}));
  await context.route("**/api/**",async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;let data:unknown={ok:true};
   if(path==="/api/v1/me")data=me;
   else if(path==="/api/v1/users")data=[me,peer];
   else if(path==="/api/v1/chats")data=[{id:chatId,kind:"group",name:"Тестовый чат",title:"Тестовый чат",ownerId:me.id,unread:0,lastAt:"2026-01-02T10:00:00.000000Z"}];
   else if(path==="/api/v1/presence")data=[];
   else if(path.endsWith("/members"))data={members:[me,peer]};
   else if(path.endsWith("/pins"))data={pins:[],total:0};
   else if(path==="/api/push")data={configured:false,enabled:true,showPreview:false,publicKey:null,mutedChatIds:[]};
   else if(path==="/api/stickers")data=[];
   else if(path.includes("/messages/")&&path.endsWith("/receipts")){readRequests++;data=[{userId:peer.id,name:peer.name,status:"read",readAt:"2026-01-03T10:20:00.000Z",deliveredAt:"2026-01-03T10:10:00.000Z"}];}
   else if(path.endsWith("/receipts"))data=[{userId:peer.id,name:peer.name,joinedAt:"2025-01-01T00:00:00.000000Z",deliveredAt:"2026-01-03T00:00:00.000000Z",readAt:"2026-01-03T00:00:00.000000Z"}];
   else if(path.endsWith("/messages"))data={messages,hasMore:false};
   else if(path.includes("/photos/")){const second=path.endsWith(photo2);opened.push(path.split("/").at(-1)!);data={messageId:second?photo2:photo1,authorName:second?peer.name:me.name,createdAt:messages[0].createdAt,text:second?"Другое фото":"Альбом",files:second?[file(12)]:[file(10),file(11)],...(second?{previousMessageId:photo1}:{nextMessageId:photo2})};}
   else if(path.endsWith("/attachments")){
    const kind=url.searchParams.get("kind");data={items:[{messageId:photo1,type:kind==="photo"?"photo":kind==="audio"?"audio":kind==="video"?"video":"file",text:kind==="photo"?"Альбом":"",authorName:me.name,createdAt:messages[0].createdAt,files:kind==="photo"?[file(10),file(11)]:kind==="links"?[]:[file(13,kind==="audio"?"audio/mp4":kind==="video"?"video/mp4":"application/octet-stream")],links:kind==="links"?["https://example.com/page"]:[]}]};
   }
   await route.fulfill({json:data});
  });
  await page.goto(`${base}/chats/${chatId}`);
  const popupCount=context.pages().length;
  await page.locator(`#message-${photo1}`).getByRole("button",{name:"Открыть фото 1",exact:true}).click();
  const viewer=page.getByRole("dialog",{name:"Просмотр фото",exact:true});await expect(viewer).toBeVisible();await expect(viewer.locator(".photo-stage img")).toHaveAttribute("src",`/media/${id(10)}`);assert.equal(context.pages().length,popupCount);
  await viewer.getByRole("button",{name:"Увеличить фото",exact:true}).click();await expect(viewer.getByRole("button",{name:"Сбросить масштаб"})).toHaveText("150%");
  await viewer.getByRole("button",{name:"Следующее фото",exact:true}).click();await expect(viewer.locator(".photo-stage img")).toHaveAttribute("src",`/media/${id(11)}`);await expect(viewer.getByRole("button",{name:"Сбросить масштаб"})).toHaveText("100%");
  await page.keyboard.press("ArrowRight");await expect(viewer.locator(".photo-stage img")).toHaveAttribute("src",`/media/${id(12)}`);await expect(viewer.getByRole("link",{name:"Скачать фото"})).toHaveAttribute("href",`/media/${id(12)}?download=1`);
  const stage=await viewer.locator(".photo-stage").boundingBox();assert.ok(stage);
  await page.mouse.move(stage.x+stage.width/2-65,stage.y+stage.height/2);await page.mouse.down();await page.mouse.move(stage.x+stage.width/2+65,stage.y+stage.height/2,{steps:6});await page.mouse.up();await expect(viewer.locator(".photo-stage img")).toHaveAttribute("src",`/media/${id(11)}`);
  await page.keyboard.press("ArrowRight");await expect(viewer.locator(".photo-stage img")).toHaveAttribute("src",`/media/${id(12)}`);
  if(width<780){
   const cdp=await context.newCDPSession(page),cx=stage.x+stage.width/2,cy=stage.y+stage.height/2;
   await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:cx-25,y:cy,id:1},{x:cx+25,y:cy,id:2}]});
   await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:cx-60,y:cy,id:1},{x:cx+60,y:cy,id:2}]});
   await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
   await expect(viewer.getByRole("button",{name:"Сбросить масштаб"})).not.toHaveText("100%");await viewer.getByRole("button",{name:"Сбросить масштаб"}).click();await cdp.detach();
  }
  await expect(viewer.locator(".photo-view-status")).toHaveCount(0);
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-photo-viewer-${width}.png`});
  await page.keyboard.press("Escape");await expect(viewer).toHaveCount(0);
  await page.getByRole("button",{name:"Вложения чата",exact:true}).click();const library=page.getByRole("dialog",{name:"Вложения · Тестовый чат",exact:true});await expect(library.getByRole("tab",{name:"Фото",exact:true})).toHaveAttribute("aria-selected","true");
  await library.getByRole("button",{name:`Открыть фото 1: ${me.name}`,exact:true}).click();await expect(viewer).toBeVisible();await page.keyboard.press("Escape");await expect(viewer).toHaveCount(0);await expect(library).toBeVisible();
  for(const tab of ["Видео","Файлы","Ссылки","Аудио"]){await library.getByRole("tab",{name:tab,exact:true}).click();await expect(library.getByRole("tabpanel",{name:tab,exact:true})).toBeVisible();if(tab==="Ссылки")await expect(library.getByRole("link",{name:"https://example.com/page"})).toHaveAttribute("rel","noopener noreferrer");}
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-attachment-library-${width}.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"library has no horizontal overflow");await library.getByRole("button",{name:"Закрыть",exact:true}).click();
  await messageAction(page, page.locator(`#message-${photo1}`), "Кто прочитал");const receipts=page.getByRole("dialog",{name:"Подробности прочтения",exact:true});await expect(receipts).toContainText(peer.name);await expect(receipts).toContainText("Прочитали · 1");await expect(receipts).toContainText("10:20");assert.equal(readRequests,1);
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-read-details-${width}.png`});await receipts.getByRole("button",{name:"Закрыть",exact:true}).click();
  assert.deepEqual(errors,[]);assert.ok(opened.includes(photo2));await context.close();console.log(`PASS photo viewer, attachment tabs and read details ${width}px`);
 }
}finally{await browser.close();await server.close();}
