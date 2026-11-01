import { messageAction } from "./message-menu";
import { chromium, expect } from "@playwright/test";
import { createServer } from "../apps/web/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url));
const server=await createServer({root,configFile:`${root}/vite.config.ts`,server:{host:"127.0.0.1",port:0}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==="string")throw new Error("Vite did not start");
const base=`http://127.0.0.1:${address.port}`,id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,"0")}`;
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1uoAAAAASUVORK5CYII=","base64");
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
const user={id:id(1),name:"Тест Один",firstName:"Тест",lastName:"Один",banned:false,role:"admin"},chatId=id(3);
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"}),page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  let messages:any[]=[],counter=10,uploaded=false;
  await context.route("**/socket.io/**",route=>route.abort());
  await context.route("**/media/**",route=>route.fulfill({contentType:"image/png",body:png}));
  await context.route("**/api/**",async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;let data:unknown={ok:true};
   if(path==="/api/v1/me")data=user;
   else if(path==="/api/v1/users")data=[user];
   else if(path==="/api/v1/chats")data=[{id:chatId,kind:"group",name:"Тестовый чат",title:"Тестовый чат",ownerId:user.id,unread:0}];
   else if(path.endsWith("/members"))data={members:[user],chat:{id:chatId}};
   else if(path.endsWith("/receipts"))data=[];
   else if(path==="/api/push")data={configured:false,publicKey:null,enabled:true,showPreview:false,mutedChatIds:[]};
   else if(path==="/api/stickers")data=[];
   else if(path==="/api/attachments"){
    const form=await new Request("http://example.com",{method:"POST",headers:request.headers(),body:new Uint8Array(request.postDataBuffer()!)}).formData();const file=form.get("file") as File;assert.ok(file.size);uploaded=true;
    const message={id:id(counter++),chatId,authorId:user.id,authorName:user.name,clientMessageId:form.get("clientMessageId"),createdAt:new Date().toISOString(),type:form.get("kind"),content:{text:form.get("text"),name:file.name,fileId:id(30),size:file.size,mime:form.get("kind")==="video"?"video/mp4":file.type==="image/png"?"image/png":"application/octet-stream"},reactions:[]};messages.push(message);data={id:message.id};
   }else if(path.includes("/photos/")){const m=messages.find(m=>m.id===path.split("/").at(-1));data={messageId:m.id,authorName:m.authorName,createdAt:m.createdAt,text:m.content.text,files:[{id:m.content.fileId,mime:m.content.mime,size:m.content.size}]};}
   else if(path.endsWith("/messages"))data={messages,hasMore:false};
   else if(request.method()==="DELETE"&&path.includes("/messages/")){const mid=path.split("/").at(-1);messages=messages.map(m=>m.id===mid?{...m,type:"deleted",content:{text:"Сообщение удалено"},deletedAt:new Date().toISOString()}:m);}
   await route.fulfill({json:data});
  });
  await page.goto(`${base}/chats/${chatId}`);
  await page.locator(".feed").click({position:{x:2,y:2}});
  for(const [label,title] of [["Прикрепить файл или видео","Отправить файл или видео"],["Записать голосовое сообщение","Отправить голосовое сообщение"],["Записать видеокружок","Отправить видеокружок"],["Выбрать стикер","Отправить стикер"],["Прикрепить фото","Отправить фото"],["Добавить эмодзи","Добавить эмодзи"],["Отправить сообщение","Отправить сообщение"]]){
   if(width<780)continue;
   if(width<780 && ["Прикрепить файл или видео","Выбрать стикер","Прикрепить фото","Отправить сообщение"].includes(label)) continue;
   const button=page.getByRole("button",{name:label,exact:true});
   if(!await button.isVisible())continue;
   await expect(button).not.toHaveAttribute("title");
   if(await button.isDisabled())continue;
   await button.hover();await expect(page.getByRole("tooltip")).toHaveText(title);
   await page.mouse.move(0,0);
  }
  const picker=page.getByLabel("Выбрать файл или видео",{exact:true});
  await picker.setInputFiles({name:"Документ.pdf",mimeType:"application/pdf",buffer:Buffer.from("test-document")});
  const dialog=page.getByRole("dialog");await expect(dialog).toContainText("100 МБ");await page.getByLabel("Подпись к файлу").fill("Подпись документа");await dialog.getByRole("button",{name:"Отправить файл",exact:true}).click();
  await expect(page.locator(".message-file")).toContainText("Документ.pdf");await expect(page.locator(".message-file")).toContainText("Подпись документа");assert.equal(uploaded,true);
  await messageAction(page, page.locator(".message-group"), "Удалить");await expect(dialog).toContainText("у всех участников");await dialog.getByRole("button",{name:"Удалить",exact:true}).click();await expect(page.locator(".deleted-message")).toHaveCount(0);await expect(page.locator(".message-group")).toHaveCount(0);await expect(page.locator(".message-file")).toHaveCount(0);await expect(page.locator(".message-tools")).toHaveCount(0);
  await picker.setInputFiles({name:"Видео.mp4",mimeType:"video/mp4",buffer:Buffer.from("video-fixture")});await expect(dialog).toContainText("500 МБ");await dialog.getByRole("button",{name:"Отправить файл",exact:true}).click();await expect(page.locator(".message-video")).toBeVisible();await expect(page.locator(".message-file")).toContainText("Видео.mp4");
  await picker.setInputFiles({name:"Оригинальное фото.png",mimeType:"image/png",buffer:png});
  await dialog.getByRole("button",{name:"Отправить файл",exact:true}).click();
  const imageFile=page.locator(".message-file").filter({hasText:"Оригинальное фото.png"});
  await expect(imageFile.locator("img")).toBeVisible();await expect.poll(()=>imageFile.locator("img").evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(imageFile.locator("a[download]")).toHaveAttribute("href",`/media/${id(30)}?download=1`);
  await imageFile.getByRole("button",{name:"Открыть фото",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Просмотр фото",exact:true})).toBeVisible();
  await expect(page.locator(".photo-stage img")).toBeVisible();
  await page.getByRole("dialog",{name:"Просмотр фото",exact:true}).getByRole("button",{name:"Закрыть",exact:true}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"no horizontal overflow");assert.deepEqual(errors,[]);await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-attachments-${width}.png`});await context.close();console.log(`PASS attachment and delete UI ${width}px`);
 }
}finally{await browser.close();await server.close();}
