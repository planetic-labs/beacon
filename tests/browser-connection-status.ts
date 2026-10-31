// A local Socket.IO fixture exercises real connect/disconnect events, never dev sessions.
import {chromium,expect} from "@playwright/test";
import {Server} from "socket.io";
import {createServer} from "../apps/web/node_modules/vite/dist/node/index.js";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url)),server=await createServer({root,configFile:root+"vite.config.ts",server:{host:"127.0.0.1",port:0}});
let available=false;
const socket=new Server(server.httpServer!,{allowRequest:(_request,callback)=>callback(null,available)});
await server.listen();const base=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`;
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
try{for(const width of [390,320,1440]){
 available=false;const context=await browser.newContext({viewport:{width,height:800},serviceWorkers:"block"}),page=await context.newPage();
 let peerOnline=true,selfOnline=false;
 await context.route("**/api/**",route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({json:path==="/api/v1/me"?{id:"019a0000-0000-7000-8000-000000000001",name:"Тестовый Пользователь",firstName:"Тестовый",lastName:"Пользователь",role:"user",banned:false}:path==="/api/v1/presence"?[{userId:"019a0000-0000-7000-8000-000000000001",online:selfOnline},{userId:"019a0000-0000-7000-8000-000000000002",online:peerOnline},{userId:"019a0000-0000-7000-8000-000000000003",online:false}]:path==="/api/push"?{configured:false}:[]});});
 await page.goto(base);
 const dot=page.locator(".profile-connection-dot"),status=page.locator(".profile-connection-label");
 await expect(dot).toHaveClass(/connecting/);await expect(status).toHaveText("Подключается…");
 await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-connecting-${width}.png`});
 available=true;await expect(dot).toHaveClass(/connected/,{timeout:15000});await expect(status).toHaveText("2 из 3 в сети");
 selfOnline=true;socket.emit("presence.changed",{userId:"019a0000-0000-7000-8000-000000000001"});await expect(status).toHaveText("2 из 3 в сети");
 peerOnline=false;socket.emit("presence.changed",{userId:"019a0000-0000-7000-8000-000000000002"});await expect(status).toHaveText("1 из 3 в сети");
 selfOnline=false;socket.emit("presence.changed",{userId:"019a0000-0000-7000-8000-000000000001"});await expect(status).toHaveText("1 из 3 в сети");
 available=false;for(const client of socket.sockets.sockets.values())client.conn.close();
 await expect(dot).toHaveClass(/connecting/);await expect(status).toHaveText("Подключается…");
 available=true;await expect(dot).toHaveClass(/connected/,{timeout:15000});
 const avatar=await page.locator(".compact-list-header > .profile-avatar-button").boundingBox(),tabs=await page.getByRole("tablist",{name:"Папки чатов"}).boundingBox();assert.ok(avatar&&tabs&&tabs.y-avatar.y-avatar.height>=0&&tabs.y-avatar.y-avatar.height<=3,"Thin gap without overlap");
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-connected-${width}.png`});
 await context.close();console.log(`PASS connecting, connected, lost and restored connection ${width}px`);
}}finally{await browser.close();await new Promise<void>(resolve=>socket.close(()=>resolve()));await server.close();}
