// CDP touch gestures against synthetic chats; never changes development data.
import {chromium,expect,type Page,type CDPSession} from "@playwright/test";
import {createServer} from "../apps/web/node_modules/vite/dist/node/index.js";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url)),server=await createServer({root,configFile:root+"vite.config.ts",server:{host:"127.0.0.1",port:0}});await server.listen();
const base=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`,id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,"0")}`;
const me={id:id(1),name:"Тест Один",firstName:"Тест",lastName:"Один",role:"user",banned:false},peer={...me,id:id(2),name:"Тест Два"};
const chats=Array.from({length:30},(_,n)=>({id:id(n+3),kind:n?"group":"direct",peerId:n?undefined:peer.id,name:n?`Группа ${n}`:peer.name,lastAt:"2026-01-01T10:00:00Z",unread:0}));
const folders=Array.from({length:8},(_,n)=>({id:id(100+n),name:n===0?"Личные":`Подборка ${n}`,chatIds:[chats[n].id]}));
const messages=Array.from({length:40},(_,n)=>({id:id(200+n),chatId:chats[0].id,authorId:n%2?me.id:peer.id,authorName:n%2?me.name:peer.name,type:"text",content:{text:`Сообщение ${n}`},createdAt:new Date(Date.UTC(2026,0,1,10,n)).toISOString(),reactions:[],...(n===39?{replyToId:id(238),reply:{id:id(238),text:"Цитата",authorName:peer.name}}:{})}));
async function swipe(cdp:CDPSession,x:number,y:number,dx:number,dy=0,steps=10,cancel=false){
 await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});
 // Sample real browser frames instead of delivering a whole gesture in one frame.
 for(let step=1;step<=steps;step++){
  await cdp.send("Runtime.evaluate",{expression:"new Promise(resolve=>requestAnimationFrame(resolve))",awaitPromise:true});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:x+dx*step/steps,y:y+dy*step/steps}]});
 }
 await cdp.send("Input.dispatchTouchEvent",{type:cancel?"touchCancel":"touchEnd",touchPoints:[]});
}
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
try{for(const width of [390,320]){
 const context=await browser.newContext({viewport:{width,height:850},isMobile:true,hasTouch:true,serviceWorkers:"block"}),page=await context.newPage(),errors:string[]=[];
 page.on("pageerror",error=>errors.push(error.message));await context.route("**/socket.io/**",r=>r.abort());
 await context.route("**/api/**",async route=>{const path=new URL(route.request().url()).pathname;let data:unknown=[];
  if(path==="/api/v1/me")data=me;else if(path==="/api/v1/users")data=[me,peer];else if(path==="/api/v1/chats")data=chats;else if(path==="/api/v1/chat-folders")data=folders;else if(path.endsWith("/messages"))data={messages,hasMore:false};else if(path==="/api/push")data={configured:false};await route.fulfill({json:data});
 });
 const cdp=await context.newCDPSession(page);await cdp.send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:2});
 await page.goto(base);await expect(page.getByRole("tab")).toHaveCount(9);
 await expect(page.locator(".app")).toHaveAttribute("data-device","mobile");
 await expect(page.locator(".chat-row")).toHaveCount(chats.length);
 const active=()=>page.getByRole("tab",{selected:true});
 await swipe(cdp,width-65,260,-95);await expect(active()).toHaveText("Личные");await expect(page).toHaveURL(base+"/");await expect(page.locator(".chat-row")).toHaveCount(1);
 await swipe(cdp,80,260,95);await expect(active()).toHaveText("Все чаты");
 await swipe(cdp,80,260,95);await expect(active()).toHaveText("Все чаты");
 await swipe(cdp,width-65,260,-25);await expect(active()).toHaveText("Все чаты");
 await swipe(cdp,8,260,100);await expect(active()).toHaveText("Все чаты");
 await swipe(cdp,width-65,260,-95,0,10,true);await expect(active()).toHaveText("Все чаты");
 const list=page.locator(".chat-rows");await list.evaluate(node=>{node.scrollTop=0;});await swipe(cdp,width/2,430,3,-140);await expect.poll(()=>list.evaluate(node=>node.scrollTop)).toBeGreaterThan(40);await expect(active()).toHaveText("Все чаты");
 const strip=page.getByRole("tablist",{name:"Папки чатов"}),stripBox=await strip.boundingBox();assert.ok(stripBox);await swipe(cdp,width-70,stripBox.y+stripBox.height/2,-130);await expect.poll(()=>strip.evaluate(node=>node.scrollLeft)).toBeGreaterThan(20);await expect(active()).toHaveText("Все чаты");
 await page.getByRole("tab",{name:"Подборка 7",exact:true}).click();await swipe(cdp,width-65,260,-100);await expect(active()).toHaveText("Подборка 7");
 await page.goto(base+`/chats/${chats[0].id}`);await expect(page.locator(".feed [data-message-id]")).toHaveCount(40);
 const row=page.locator(`[data-message-id="${id(239)}"]`);await row.scrollIntoViewIfNeeded();let box=await row.locator(".bubble-text").boundingBox();assert.ok(box);let x=box.x+box.width/2,y=box.y+box.height/2;
 await swipe(cdp,x,y,-85);await page.waitForTimeout(650);await expect(page.locator(".composer-context")).toContainText("Сообщение 39");await expect(page.getByRole("menu")).toHaveCount(0);await expect(page.getByRole("checkbox")).toHaveCount(0);
 await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-swipe-reply-${width}.png`});await page.getByRole("button",{name:"Отменить контекст сообщения"}).click();
 await row.scrollIntoViewIfNeeded();box=await row.locator(".bubble-text").boundingBox();assert.ok(box);x=box.x+box.width/2;y=box.y+box.height/2;
 await swipe(cdp,x,y,-25);await expect(page.locator(".composer-context")).toHaveCount(0);await expect(page.getByRole("menu")).toHaveCount(0);
 await swipe(cdp,x,y,-85,0,10,true);await expect(page.locator(".composer-context")).toHaveCount(0);await expect(page.locator("[data-swipe-active]")).toHaveCount(0);
 await swipe(cdp,x,y,-85);await expect(page.locator(".composer-context")).toContainText("Сообщение 39");await page.getByRole("button",{name:"Отменить контекст сообщения"}).click();
 await row.getByRole("button",{name:/Цитата/}).tap();await expect(page.locator(`#message-${id(238)}`)).toHaveClass(/highlight/);
 await row.scrollIntoViewIfNeeded();
 // Closing the menu restores focus in a later animation frame. Do not start
 // the next native touch while its overlay/focus cleanup is still pending.
 await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
 await row.locator(".bubble-text").tap();await expect(page.getByRole("menu",{name:"Действия с сообщением",exact:true})).toBeVisible();await page.keyboard.press("Escape");
 await expect(page.getByRole("menu",{name:"Действия с сообщением",exact:true})).toHaveCount(0);
 await expect(page.locator(".message-menu-backdrop")).toHaveCount(0);
 await expect(row).toBeFocused();
 await row.scrollIntoViewIfNeeded();
 box=await row.locator(".bubble-text").boundingBox();assert.ok(box);
 await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});await expect(page.locator(".selection-toolbar")).toContainText("Выбрано: 1");await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
 await page.getByRole("button",{name:"Отменить выбор",exact:true}).click();
 await cdp.send("Emulation.setCPUThrottlingRate",{rate:1});
 assert.deepEqual(errors,[]);await context.close();console.log(`PASS reply swipe, folder swipes, native scrolling, thresholds, edge/cancel, tap and long press ${width}px`);
}}finally{await browser.close();await server.close();}
