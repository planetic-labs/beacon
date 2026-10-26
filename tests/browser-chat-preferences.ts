import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
if(process.env.APP_ENV!=="test")throw new Error("Disposable environment required");
const base=process.env.APP_URL!,fixtures=JSON.parse(await readFile("/run/test/browser.json","utf8"));
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
try{
 const contexts=[];
 for(const user of [fixtures.users[0],fixtures.users[0],fixtures.users[1]]){
  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:"block"});
  await context.addCookies([{name:user.cookieName,value:user.cookieValue,url:base}]);
  await context.route("**/socket.io/**",async route=>{try{const url=new URL(route.request().url());url.port=new URL(process.env.TEST_SOCKET_URL??"http://localhost:3001").port;const response=await route.fetch({url:url.toString(),headers:{...route.request().headers(),origin:base}});await route.fulfill({response});}catch{await route.abort();}});
  contexts.push(context);
 }
 const [a,b,other]=await Promise.all(contexts.map(c=>c.newPage()));
 const errors:string[]=[];for(const page of [a,b,other])page.on("pageerror",e=>errors.push(e.message));
 await Promise.all([a,b,other].map(p=>p.goto(`${base}/chats/${fixtures.chatId}`)));
 const input=(p:typeof a)=>p.getByLabel("Сообщение",{exact:true});
 await input(a).fill("Синхронный черновик");
 await expect(input(b)).toHaveValue("Синхронный черновик",{timeout:15000});
 await expect(input(other)).toHaveValue("");
 await input(b).fill("Изменено на другом устройстве");await expect(input(a)).toHaveValue("Изменено на другом устройстве",{timeout:15000});
 await a.reload();await expect(input(a)).toHaveValue("Изменено на другом устройстве",{timeout:15000});
 await a.getByRole("button",{name:"Отправить сообщение",exact:true}).click();await expect(input(b)).toHaveValue("",{timeout:15000});
 await a.getByRole("button",{name:"Закрепить чат",exact:true}).click();await expect(b.getByRole("button",{name:"Открепить чат",exact:true})).toBeVisible({timeout:15000});
 await expect(other.getByRole("button",{name:"Закрепить чат",exact:true})).toBeVisible();
 await b.getByRole("button",{name:"Открепить чат",exact:true}).click();await expect(a.getByRole("button",{name:"Закрепить чат",exact:true})).toBeVisible({timeout:15000});
 await a.getByRole("button",{name:"Участники и настройки чата",exact:true}).click();
 await a.getByRole("dialog").getByLabel("Описание",{exact:true}).fill("Описание тестовой группы");await a.getByRole("dialog").getByRole("button",{name:"Сохранить",exact:true}).click();
 await expect(a.getByRole("dialog").getByLabel("Описание",{exact:true})).toHaveValue("Описание тестовой группы");
 await other.getByRole("button",{name:"Участники и настройки чата",exact:true}).click();
 await expect(other.getByRole("dialog")).toContainText("Описание тестовой группы");await expect(other.getByRole("dialog").getByRole("combobox",{name:"Добавить участника",exact:true})).toBeVisible();
 await expect(other.getByRole("dialog").getByLabel("Название",{exact:true})).toHaveCount(0);
 await other.keyboard.press("Escape");await a.keyboard.press("Escape");
 for(const width of [390,320]){
  await a.setViewportSize({width,height:900});
  await expect(a.getByRole("button",{name:"Закрепить чат",exact:true})).toBeVisible();
  assert.ok(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no overflow ${width}`);
  await a.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-chat-preferences-${width}.png`});
 }
 assert.deepEqual(errors,[]);console.log("PASS private draft sync, send clearing, reload, personal pins, group description and mobile layout");
 for(const context of contexts)await context.close();
}finally{await browser.close();}
