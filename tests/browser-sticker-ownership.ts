// Synthetic accounts only. Never modifies the working development deployment.
import {chromium,expect} from "@playwright/test";
import {createServer} from "../apps/web/node_modules/vite/dist/node/index.js";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url));
const server=await createServer({root,configFile:`${root}/vite.config.ts`,server:{host:"127.0.0.1",port:0}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==="string")throw new Error("Missing Vite address");
const base=`http://127.0.0.1:${address.port}`,id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,"0")}`;
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
try{
 for(const role of ["user","admin"])for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"}),page=await context.newPage(),errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  const me={id:id(1),name:"Тестовый пользователь",firstName:"Тестовый",lastName:"Пользователь",email:"user@example.com",role,banned:false};
  let packs=[{id:id(10),name:"Мой набор",active:true,ownerId:me.id,ownerName:me.name,stickers:[]},{id:id(11),name:"Чужой набор",active:true,ownerId:id(2),ownerName:"Другой пользователь",stickers:[]}];
  const scopes:string[]=[];
  await context.route("**/socket.io/**",route=>route.abort());
  await context.route("**/api/**",async route=>{
   const req=route.request(),url=new URL(req.url()),path=url.pathname;let data:unknown=[];
   if(path==="/api/v1/me")data=me;
   else if(path==="/api/v1/users")data=[me];
   else if(path==="/api/stickers"){
    if(req.method()==="GET"){
     const scope=url.searchParams.get("scope")||"catalog";scopes.push(scope);
     data=packs.filter(pack=>scope==="mine"?pack.ownerId===me.id:scope==="all"?true:pack.active);
    }else if(req.method()==="POST"){
     const body=req.postDataJSON();const pack={id:id(12),name:body.name,active:true,ownerId:me.id,ownerName:me.name,stickers:[]};packs.push(pack);data={id:pack.id};
    }
   }else if(path.startsWith("/api/stickers/")){
    const packId=path.split("/")[3];
    if(req.method()==="PATCH")Object.assign(packs.find(pack=>pack.id===packId)!,req.postDataJSON());
    else if(req.method()==="DELETE")packs=packs.filter(pack=>pack.id!==packId);
    data={ok:true};
   }
   await route.fulfill({json:data});
  });
  await page.goto(`${base}/settings/stickers`);
  await expect(page.getByRole("heading",{name:"Мои наборы стикеров",exact:true})).toBeVisible();
  await expect(page.locator(".sticker-admin-pack")).toHaveCount(1);
  await expect(page.locator(".sticker-admin-pack")).toContainText("Мой набор");
  await expect(page.getByText("Чужой набор · 0",{exact:true})).toHaveCount(0);assert.ok(scopes.includes("mine"));
  await page.getByRole("button",{name:"Отключить набор",exact:true}).click();
  await expect(page.getByRole("button",{name:"Включить набор",exact:true})).toBeVisible();
  await page.getByRole("textbox",{name:"Название набора стикеров",exact:true}).fill("Новый личный набор");
  await page.getByRole("button",{name:"Создать набор",exact:true}).click();
  await expect(page.locator(".sticker-admin-pack")).toHaveCount(2);
  await page.getByRole("button",{name:"Удалить набор Новый личный набор",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Удалить набор?",exact:true});await expect(dialog).toContainText("Уже отправленные стикеры сохранятся");
  await dialog.getByRole("button",{name:"Отмена",exact:true}).click();await expect(page.locator(".sticker-admin-pack")).toHaveCount(2);
  await page.getByRole("button",{name:"Удалить набор Новый личный набор",exact:true}).click();
  await dialog.getByRole("button",{name:"Удалить набор",exact:true}).click();await expect(page.locator(".sticker-admin-pack")).toHaveCount(1);
  if(role==="admin"){
   await page.goto(`${base}/admin/stickers`);await expect(page.locator(".sticker-admin-pack")).toHaveCount(2);
   await expect(page.getByText("Владелец: Другой пользователь",{exact:true})).toBeVisible();assert.ok(scopes.includes("all"));
   await page.goto(`${base}/settings/stickers`);await expect(page.locator(".sticker-admin-pack")).toHaveCount(1);
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-own-stickers-${role}-${width}.png`});
  await context.close();console.log(`PASS sticker ownership management ${role} ${width}px`);
 }
}finally{await browser.close();await server.close();}
