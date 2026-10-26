// Synthetic conversations: never changes accounts or messages in the running dev deployment.
import { chromium, expect } from "@playwright/test";
import { createServer } from "../apps/web/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url));
const server=await createServer({root,configFile:`${root}/vite.config.ts`,server:{host:"127.0.0.1",port:0}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==="string")throw new Error("Vite did not start");
const base=`http://127.0.0.1:${address.port}`,id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,"0")}`;
const me={id:id(1),name:"Тест Один",firstName:"Тест",lastName:"Один",role:"user",banned:false},peer={id:id(2),name:"Тест Два",banned:false},chatId=id(3);
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"}),page=await context.newPage();
  const errors:string[]=[],external:string[]=[],sent:any[]=[];let current=me;
  page.on("pageerror",e=>errors.push(e.message));page.on("request",request=>{if(!request.url().startsWith(base)&&!request.url().startsWith("data:"))external.push(request.url());});
  await context.route("**/socket.io/**",route=>route.abort());
  await context.route("**/api/**",async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;let data:unknown={ok:true};
   if(path==="/api/v1/me")data=current;
   else if(path==="/api/v1/users")data=[me,peer];
   else if(path==="/api/v1/chats")data=[{id:chatId,kind:"direct",name:peer.name,peerId:peer.id,unread:0,lastAt:"2026-01-01T10:00:00Z"}];
   else if(path==="/api/v1/presence"||path==="/api/v1/drafts"||path.endsWith("/receipts"))data=[];
   else if(path.endsWith("/members"))data={members:[me,peer]};
   else if(path.endsWith("/pins"))data={pins:[],total:0};
   else if(path==="/api/push")data={configured:false,enabled:true,showPreview:false,publicKey:null,mutedChatIds:[]};
   else if(path==="/api/stickers")data=[];
   else if(path.endsWith("/messages")){
    if(request.method()==="POST"){const value=request.postDataJSON();sent.push(value);data={id:value.clientMessageId};}
    else data={messages:[],hasMore:false};
   }
   await route.fulfill({json:data});
  });
  await page.goto(`${base}/chats/${chatId}`);const input=page.getByLabel("Сообщение",{exact:true}),open=page.getByRole("button",{name:"Добавить эмодзи",exact:true});
  await input.fill("Привет мир");await input.evaluate((node:HTMLTextAreaElement)=>node.setSelectionRange(7,7));await open.click();
  const menu=page.getByRole("dialog",{name:"Эмодзи",exact:true}),search=menu.getByRole("textbox",{name:"Поиск эмодзи",exact:true});
  await expect(search).toBeVisible();await search.fill("улыбка");const grin=menu.locator('[data-epr-unified="1f600"]').first();await expect(grin).toBeVisible();await grin.click();
  await expect(input).toHaveValue("Привет 😀мир");await grin.click();await expect(input).toHaveValue("Привет 😀😀мир");assert.equal(sent.length,0,"selection never sends a message");
  await page.keyboard.press("Escape");await expect(menu).toHaveCount(0);await expect(open).toBeFocused();
  await input.evaluate((node:HTMLTextAreaElement)=>node.setSelectionRange(7,11));await open.click();await expect(menu).toBeVisible();
  await expect(menu.getByRole("rowgroup",{name:"Недавно использованные",exact:true})).toBeVisible();
  await menu.locator('[data-epr-unified="1f600"]').first().click();await expect(input).toHaveValue("Привет 😀мир");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no overflow at ${width}`);
  const bounds=await menu.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width+1&&bounds.y>=0&&bounds.y+bounds.height<=901,"panel stays within viewport");
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-emoji-${width}.png`});
  await menu.getByRole("button",{name:"Закрыть",exact:true}).click();await page.getByRole("button",{name:"Отправить сообщение",exact:true}).click();await expect.poll(()=>sent.length).toBe(1);assert.equal(sent[0].text,"Привет 😀мир");
  await open.click();await expect(menu.getByRole("rowgroup",{name:"Недавно использованные",exact:true})).toBeVisible();await page.keyboard.press("Escape");
  await page.reload();await page.getByRole("button",{name:"Добавить эмодзи",exact:true}).click();await expect(menu.getByRole("rowgroup",{name:"Недавно использованные",exact:true})).toBeVisible();await page.keyboard.press("Escape");
  current={...me,id:id(4)};await page.reload();await page.getByRole("button",{name:"Добавить эмодзи",exact:true}).click();await expect(menu.getByRole("textbox",{name:"Поиск эмодзи",exact:true})).toBeVisible();await expect(menu.getByRole("rowgroup",{name:"Недавно использованные",exact:true})).toHaveCount(0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[],"native emoji never request external services");
  await context.close();console.log(`PASS emoji search, caret insertion, selection replacement, multiple picks, private recents and layout ${width}px`);
 }
}finally{await browser.close();await server.close();}
