// Synthetic folders and chats: no development accounts or data are modified.
import {chromium,expect} from "@playwright/test";
import {createServer} from "../apps/web/node_modules/vite/dist/node/index.js";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url)),server=await createServer({root,configFile:root+"vite.config.ts",server:{host:"127.0.0.1",port:0}});await server.listen();
const base=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`,id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,"0")}`;
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
try{for(const width of [1440,390,320]){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"}),page=await context.newPage(),errors:string[]=[];
 page.on("pageerror",error=>errors.push(error.message));
 const me={id:id(1),name:"Тест Один",firstName:"Тест",lastName:"Один",role:"user",banned:false},peer={...me,id:id(2),name:"Тест Два"};
 const chats=[{id:id(3),kind:"direct",name:peer.name,peerId:peer.id,lastAt:"2026-01-01T10:00:00Z",unread:1},{id:id(4),kind:"group",name:"Природа",unread:0}];
 let folders:{id:string;name:string;chatIds:string[]}[]=[];
 await context.route("**/socket.io/**",r=>r.abort());
 await context.route("**/api/**",async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data:unknown=[];
  if(path==="/api/v1/me")data=me;else if(path==="/api/v1/users")data=[me,peer];else if(path==="/api/v1/chats")data=chats;
  else if(path.startsWith("/api/v1/chat-folders")){
   if(req.method()==="POST"){folders.push({id:id(5),...req.postDataJSON()});data={id:id(5)};}
   else if(req.method()==="PATCH"){folders=[{id:id(5),...req.postDataJSON()}];data={id:id(5)};}
   else if(req.method()==="DELETE"){folders=[];data={ok:true};}else data=folders;
  }else if(path==="/api/push")data={configured:false};
  await route.fulfill({json:data});
 });
 await page.goto(base+"/");await expect(page.locator(".chat-row")).toHaveCount(2);
 await page.getByRole("button",{name:"Меню списка чатов",exact:true}).click();
 await expect(page.getByRole("menuitem")).toHaveText(["Создать группу","Избранное"]);
 await page.getByRole("menuitem",{name:"Создать группу",exact:true}).click();
 await expect(page.getByRole("dialog").getByRole("combobox")).toHaveValue("group");await page.keyboard.press("Escape");
 await page.goto(base+"/settings");await page.getByRole("navigation",{name:"Разделы настроек"}).getByRole("button",{name:"Папки чатов",exact:true}).click();
 await page.getByRole("button",{name:"Создать папку",exact:true}).click();
 await page.getByRole("textbox",{name:"Название папки"}).fill("Личные");await page.getByRole("checkbox",{name:peer.name}).check();
 await page.getByRole("button",{name:"Сохранить",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);assert.equal(folders.length,1);
 await page.goto(base+"/");await page.getByRole("tab",{name:/Личные/}).click();await expect(page.locator(".chat-row")).toHaveCount(1);await expect(page.locator(".chat-row")).toContainText(peer.name);
 await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-chat-folders-${width}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.getByRole("tab",{name:/Все чаты/}).click();await expect(page.locator(".chat-row")).toHaveCount(2);
 await page.goto(base+"/settings/folders");await page.getByRole("button",{name:"Изменить",exact:true}).click();await page.getByRole("textbox",{name:"Название папки"}).fill("Сообщество");await page.getByRole("checkbox",{name:peer.name}).uncheck();await page.getByRole("checkbox",{name:"Природа",exact:true}).check();await page.getByRole("button",{name:"Сохранить",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
 await page.goto(base+"/");await page.getByRole("tab",{name:"Сообщество",exact:true}).click();await expect(page.locator(".chat-row")).toHaveCount(1);await expect(page.locator(".chat-row")).toContainText("Природа");
 await page.goto(base+"/settings/folders");await page.getByRole("button",{name:"Удалить",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Удалить папку",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
 await page.goto(base+"/");await expect(page.getByRole("tab")).toHaveCount(1);await expect(page.locator(".chat-row")).toHaveCount(2);assert.deepEqual(errors,[]);
 await context.close();console.log(`PASS folder settings, filtering, editing, deletion and minimal menu ${width}px`);
}}finally{await browser.close();await server.close();}
