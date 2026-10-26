import { chromium, expect } from "@playwright/test";
import { createServer } from "../apps/web/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url));
const server=await createServer({root,configFile:`${root}/vite.config.ts`,server:{host:"127.0.0.1",port:0}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==="string")throw new Error("Vite did not start");
const base=`http://127.0.0.1:${address.port}`,id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,"0")}`;
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
const user={id:id(1),name:"Тест Один",firstName:"Тест",lastName:"Один",banned:false,role:"admin"},chatId=id(3);
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"}),page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  let messages:any[]=[],counter=10,uploaded=false;
  await context.route("**/socket.io/**",route=>route.abort());
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
    const message={id:id(counter++),chatId,authorId:user.id,authorName:user.name,clientMessageId:form.get("clientMessageId"),createdAt:new Date().toISOString(),type:form.get("kind"),content:{text:form.get("text"),name:file.name,fileId:id(30),size:file.size,mime:form.get("kind")==="video"?"video/mp4":"application/octet-stream"},reactions:[]};messages.push(message);data={id:message.id};
   }else if(path.endsWith("/messages"))data={messages,hasMore:false};
   else if(request.method()==="DELETE"&&path.includes("/messages/")){const mid=path.split("/").at(-1);messages=messages.map(m=>m.id===mid?{...m,type:"deleted",content:{text:"Сообщение удалено"},deletedAt:new Date().toISOString()}:m);}
   await route.fulfill({json:data});
  });
  await page.goto(`${base}/chats/${chatId}`);
  const picker=page.getByLabel("Выбрать файл или видео",{exact:true});
  await picker.setInputFiles({name:"Документ.pdf",mimeType:"application/pdf",buffer:Buffer.from("test-document")});
  const dialog=page.getByRole("dialog");await expect(dialog).toContainText("100 МБ");await page.getByLabel("Подпись к файлу").fill("Подпись документа");await dialog.getByRole("button",{name:"Отправить файл",exact:true}).click();
  await expect(page.locator(".message-file")).toContainText("Документ.pdf");await expect(page.locator(".message-file")).toContainText("Подпись документа");assert.equal(uploaded,true);
  await page.locator(".message-group").getByRole("button",{name:"Удалить",exact:true}).click();await expect(dialog).toContainText("у всех участников");await dialog.getByRole("button",{name:"Удалить",exact:true}).click();await expect(page.locator(".deleted-message")).toHaveText("Сообщение удалено");await expect(page.locator(".message-file")).toHaveCount(0);await expect(page.locator(".message-tools")).toHaveCount(0);
  await picker.setInputFiles({name:"Видео.mp4",mimeType:"video/mp4",buffer:Buffer.from("video-fixture")});await expect(dialog).toContainText("500 МБ");await dialog.getByRole("button",{name:"Отправить файл",exact:true}).click();await expect(page.locator(".message-video")).toBeVisible();await expect(page.locator(".message-file")).toContainText("Видео.mp4");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"no horizontal overflow");assert.deepEqual(errors,[]);await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-attachments-${width}.png`});await context.close();console.log(`PASS attachment and delete UI ${width}px`);
 }
}finally{await browser.close();await server.close();}
