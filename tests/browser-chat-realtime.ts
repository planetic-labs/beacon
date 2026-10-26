// End-to-end fixtures are created only in a disposable APP_ENV=test deployment.
import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
if(process.env.APP_ENV!=="test")throw new Error("Disposable test environment required");
const base=process.env.APP_URL!,socketUrl=process.env.TEST_SOCKET_URL??"http://localhost:3001";
const fixtures=JSON.parse(await readFile("/run/test/browser.json","utf8"));
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"]});
try{
 const contexts=[];
 for(const user of fixtures.users){
  const context=await browser.newContext({viewport:{width:1440,height:900},permissions:["microphone","camera"],serviceWorkers:"block"});
  await context.addCookies([{name:user.cookieName,value:user.cookieValue,url:base}]);
  await context.route("**/socket.io/**",async route=>{try{const url=new URL(route.request().url());url.port=new URL(socketUrl).port;const response=await route.fetch({url:url.toString(),headers:{...route.request().headers(),origin:base}});await route.fulfill({response});}catch{await route.abort();}});
  contexts.push(context);
 }
 const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));const errors:string[]=[];a.on("pageerror",e=>errors.push(e.message));b.on("pageerror",e=>errors.push(e.message));
 await Promise.all([a.goto(`${base}/chats/${fixtures.chatId}`),b.goto(`${base}/chats/${fixtures.chatId}`)]);
 await expect(a.locator(".list-presence")).toContainText("Подключено");await expect(b.locator(".list-presence")).toContainText("Подключено");
 await a.getByLabel("Сообщение",{exact:true}).fill("Доставлено без открытия переписки");
 await expect(b.locator(".chat-header-subtitle")).toContainText("печатает",{timeout:10000});
 await b.locator(".nav-rail").getByRole("button",{name:"Чаты",exact:true}).click();
 await a.getByRole("button",{name:"Отправить сообщение",exact:true}).click();
 const outgoing=a.locator(".message-group.outgoing",{hasText:"Доставлено без открытия переписки"});
 await expect(outgoing.locator(".delivery-status")).toHaveText("Доставлено",{timeout:10000});
 await b.getByRole("button",{name:/Чат для технических моментов/}).click();
 await expect(outgoing.locator(".delivery-status")).toHaveText("Прочитано",{timeout:10000});
 await a.getByRole("button",{name:"Записать голосовое сообщение",exact:true}).click();
 await a.getByRole("button",{name:"Начать запись",exact:true}).click();
 await expect(b.locator(".chat-header-subtitle")).toContainText("записывает голосовое",{timeout:10000});
 await a.getByRole("button",{name:"Остановить запись",exact:true}).click();await a.getByRole("button",{name:"Отмена",exact:true}).click();
 await expect(b.locator(".chat-header-subtitle")).not.toContainText("записывает",{timeout:10000});
 await b.locator(".nav-rail").getByRole("button",{name:"Чаты",exact:true}).click();
 const name=`${fixtures.users[1].firstName} ${fixtures.users[1].lastName}`;
 await a.getByLabel("Сообщение",{exact:true}).fill("Проверочноеупоминание @");await a.getByRole("option",{name,exact:true}).click();await a.getByRole("button",{name:"Отправить сообщение",exact:true}).click();
 await expect(b.getByLabel("Вас упомянули",{exact:true})).toBeVisible({timeout:10000});
 await b.getByRole("button",{name:/Чат для технических моментов/}).click();await expect(b.locator(".message-mention.self")).toHaveText(`@${name}`);
 await b.getByRole("button",{name:"Поиск в чате",exact:true}).click();await b.getByRole("searchbox").fill("проверочноеупом");await b.getByRole("button",{name:/Проверочноеупоминание/}).click();await expect(b.locator(".highlight .message-mention.self")).toBeVisible();
 const original=a.locator(".message-group.outgoing",{hasText:"Проверочноеупоминание"});
 const originalId=await original.evaluate(node=>node.closest('[id^="message-"]')!.id);
 await original.getByRole("button",{name:"Удалить",exact:true}).click();
 await a.getByRole("dialog").getByRole("button",{name:"Удалить",exact:true}).click();
 await expect(b.locator(`#${originalId} .deleted-message`)).toHaveText("Сообщение удалено",{timeout:10000});
 await expect(b.locator(`#${originalId} .message-mention`)).toHaveCount(0);
 // Group participants can pin and unpin each other's messages.
 await outgoing.getByRole("button",{name:"Закрепить сообщение",exact:true}).click();
 await expect(b.locator(".pinned-strip")).toContainText("Доставлено без открытия переписки",{timeout:10000});
 await b.getByRole("button",{name:"Все закреплённые сообщения"}).click();
 await b.getByRole("dialog").getByRole("button",{name:"Открепить",exact:true}).click();
 await expect(a.locator(".pinned-strip")).toHaveCount(0,{timeout:10000});
 await a.getByRole("button",{name:"Выбрать сообщения",exact:true}).click();
 await a.getByRole("checkbox").nth(0).check();await a.getByRole("checkbox").nth(1).check();
 await a.locator(".selection-toolbar").getByRole("button",{name:"Переслать",exact:true}).click();
 await a.getByRole("dialog").getByRole("button",{name:"Избранное",exact:true}).click();
 await expect(a.getByRole("dialog")).toHaveCount(0);
 await a.locator(".chat-list").getByRole("button",{name:"Избранное",exact:true}).click();
 await expect(a.locator(".forwarded")).toHaveCount(2,{timeout:10000});
 const savedId=new URL(a.url()).pathname.split("/").at(-1)!;
 const forbiddenSaved=await b.request.get(`${base}/api/v1/chats/${savedId}/messages`);assert.equal(forbiddenSaved.status(),403);
 // Foreground visibility, not a remembered login, controls direct-chat status.
 const direct=await a.request.post(`${base}/api/v1/chats`,{headers:{origin:base},data:{kind:"direct",userIds:[fixtures.users[1].id]}});assert.equal(direct.status(),200);const directId=(await direct.json()).id;
 await Promise.all([a.goto(`${base}/chats/${directId}`),b.goto(`${base}/chats/${directId}`)]);
 await expect(a.locator(".chat-header-subtitle")).toHaveText("В сети",{timeout:10000});
 await b.evaluate(`(() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange')); })()`);
 await expect(a.locator(".chat-header-subtitle")).toContainText("Был(а)",{timeout:10000});
 await b.evaluate(`(() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange')); })()`);
 await expect(a.locator(".chat-header-subtitle")).toHaveText("В сети",{timeout:10000});
 // A read-details window updates after the other participant opens a photo album.
 await b.locator(".nav-rail").getByRole("button",{name:"Чаты",exact:true}).click();
 const png=Buffer.from(await a.evaluate<string>(`(() => { const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,32,24);return canvas.toDataURL('image/png').split(',')[1]; })()`),"base64");
 await a.getByLabel("Выбрать фото",{exact:true}).setInputFiles([{name:"one.png",mimeType:"image/png",buffer:png},{name:"two.png",mimeType:"image/png",buffer:png}]);
 await a.getByLabel("Сообщение",{exact:true}).fill("Живойальбом");await a.getByRole("button",{name:"Отправить сообщение",exact:true}).click();
 const photoMessage=a.locator(".message-group.outgoing",{hasText:"Живойальбом"});await expect(photoMessage.locator(".message-photo")).toHaveCount(2);
 await photoMessage.getByRole("button",{name:"Кто прочитал",exact:true}).click();
 const readDialog=a.getByRole("dialog",{name:"Подробности прочтения",exact:true});await expect(readDialog).toBeVisible();
 await b.goto(`${base}/chats/${directId}`);await expect(b.locator(".bubble-text",{hasText:"Живойальбом"})).toBeVisible();
 await expect(readDialog).toContainText("Прочитали · 1",{timeout:10000});await expect(readDialog).not.toContainText("Время не зафиксировано");
 await readDialog.getByRole("button",{name:"Закрыть",exact:true}).click();
 await photoMessage.getByRole("button",{name:"Открыть фото 1",exact:true}).click();
 const viewer=a.getByRole("dialog",{name:"Просмотр фото",exact:true});await expect(viewer.locator(".photo-stage img")).toBeVisible();await expect.poll(()=>viewer.locator(".photo-stage img").evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 await viewer.getByRole("button",{name:"Следующее фото",exact:true}).click();await expect(viewer).toContainText("2 / 2");await a.keyboard.press("Escape");
 await a.getByRole("button",{name:"Вложения чата",exact:true}).click();await expect(a.locator(".attachment-photo-grid img")).toHaveCount(2);await expect.poll(()=>a.locator(".attachment-photo-grid img").first().evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 await a.getByRole("dialog").getByRole("button",{name:"Закрыть",exact:true}).click();
 assert.deepEqual(errors,[]);await expect(a.getByRole("alert")).toHaveCount(0);await expect(b.getByRole("alert")).toHaveCount(0);
 console.log("PASS actual UI typing, recording, delivered/read, mentions, indexed search and deletion, pins, saved batch, foreground presence, live photo viewer and receipt times");
}finally{await browser.close();}
