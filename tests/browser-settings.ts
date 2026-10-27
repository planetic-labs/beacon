// Synthetic users only; verifies navigation without modifying development accounts.
import { chromium, expect } from "@playwright/test";
import { createServer } from "../apps/web/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {version} from "../package.json";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url));
const server=await createServer({root,configFile:`${root}/vite.config.ts`,server:{host:"127.0.0.1",port:0}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==="string")throw new Error("Vite did not start");
const base=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
try{
 for(const role of ["user","admin"])for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:"block"}),page=await context.newPage(),errors:string[]=[];
  const me={id:"019a0000-0000-7000-8000-000000000001",name:"Тестовый пользователь",firstName:"Тестовый",lastName:"Пользователь",email:"user@example.com",banned:false,role};
  page.on("pageerror",error=>errors.push(error.message));
  await context.route("**/socket.io/**",route=>route.abort());
  await context.route("**/api/**",async route=>{
   const path=new URL(route.request().url()).pathname;
   const value=path==="/api/v1/admin/groups"?(width===1440?[{id:"019a0000-0000-7000-8000-000000000002",name:"Редакторы",code:"editors",members:[me.id]}]:[]):path==="/api/v1/me"?me:path==="/api/v1/users"?[me]:path==="/api/push"?{configured:false,enabled:true,showPreview:false,publicKey:null,mutedChatIds:[]}:[];
   await route.fulfill({json:value});
  });
  await page.goto(base);await expect(page.getByRole("heading",{name:"Чаты",exact:true})).toBeVisible();
  const navigation=width>780?page.locator(".nav-rail"):page.getByRole("navigation",{name:"Навигация",exact:true});
  await navigation.getByRole("button",{name:"Настройки",exact:true}).click();await expect(page).toHaveURL(`${base}/settings`);
  const sections=page.getByRole("navigation",{name:"Разделы настроек",exact:true});await expect(sections).toBeVisible();
  if(width>780){
   await expect(page.locator(".settings")).toBeVisible();
   const columns=await page.locator(".admin-shell").evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(" "));assert.equal(columns.length,3);
  }else await expect(page.locator(".settings")).toBeHidden();
  await expect(sections.getByRole("button").last()).toHaveText("О приложении");
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-settings-menu-${role}-${width}.png`});
  await sections.getByRole("button",{name:"Профиль",exact:true}).click();await expect(page).toHaveURL(`${base}/settings/profile`);
  await expect(page.locator(".settings").getByRole("heading",{name:"Профиль",exact:true})).toBeVisible();await expect(page.getByLabel("Имя",{exact:true})).toHaveValue(me.firstName);
  await expect(page.getByRole("heading",{name:"Ключи доступа",exact:true})).toHaveCount(0);await expect(page.getByRole("heading",{name:"Push-уведомления",exact:true})).toHaveCount(0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"no horizontal overflow");
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-settings-profile-${role}-${width}.png`});
  for(const [title,path] of [["Ключи доступа","security"],["Push-уведомления","notifications"]]){
   if(width<=780)await page.getByRole("button",{name:"Назад к разделам",exact:true}).click();
   await sections.getByRole("button",{name:title,exact:true}).click();
   await expect(page).toHaveURL(`${base}/settings/${path}`);
   await expect(page.locator(".settings-main").getByRole("heading",{name:title,exact:true})).toBeVisible();
   await expect(page.getByLabel("Имя",{exact:true})).toHaveCount(0);
   const otherTitle=path==="security"?"Push-уведомления":"Ключи доступа";
   await expect(page.locator(".settings-main").getByRole("heading",{name:otherTitle,exact:true})).toHaveCount(0);
   await page.reload();await expect(page.locator(".settings-main").getByRole("heading",{name:title,exact:true})).toBeVisible();
  }
  if(width<=780)await page.getByRole("button",{name:"Назад к разделам",exact:true}).click();
  await sections.getByRole("button",{name:"О приложении",exact:true}).click();
  await expect(page).toHaveURL(`${base}/settings/about`);
  await expect(page.locator(".about-details")).toContainText(version);
  await page.getByRole("button",{name:"Проверить обновления",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("В режиме разработки");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-settings-about-${role}-${width}.png`});
  await page.reload();await expect(page.locator(".about-details")).toContainText(version);
  if(width<=780)await page.getByRole("button",{name:"Назад к разделам",exact:true}).click();
  await sections.getByRole("button",{name:"Профиль",exact:true}).click();
  if(width<=780){await expect(sections).toBeHidden();await page.getByRole("button",{name:"Назад к разделам",exact:true}).click();await expect(sections).toBeVisible();await expect(page).toHaveURL(`${base}/settings`);await sections.getByRole("button",{name:"Профиль",exact:true}).click();}
  await page.reload();await expect(page.locator(".settings").getByRole("heading",{name:"Профиль",exact:true})).toBeVisible();
  await page.goto(`${base}/profile`);await expect(page).toHaveURL(`${base}/settings/profile`);await expect(page.locator(".settings")).toBeVisible();
  if(width<=780){await page.getByRole("button",{name:"Назад к разделам",exact:true}).click();await page.getByRole("button",{name:"Назад к чатам",exact:true}).click();}else await page.locator(".nav-rail").getByRole("button",{name:"Чаты",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Чаты",exact:true})).toBeVisible();
  if(role==="admin"){
   if(width<=780)await page.getByRole("navigation",{name:"Навигация",exact:true}).getByRole("button",{name:"Администрирование",exact:true}).click();
   else await page.locator(".nav-rail").getByRole("button",{name:"Администрирование",exact:true}).click();
   await expect(page.getByRole("navigation",{name:"Разделы администрирования",exact:true})).toBeVisible();
   await expect(page.getByLabel("Версия приложения",{exact:true})).toHaveCount(0);
   await page.getByRole("navigation",{name:"Разделы администрирования",exact:true}).getByRole("button",{name:"Группы пользователей",exact:true}).click();
   const groupList=page.locator(".admin-group-list");
   await expect(groupList.getByRole("button",{name:/Администраторы/})).toContainText("Участников: 1");
   await expect(groupList.getByRole("button",{name:/Пользователи/})).toContainText("Участников: 0");
   if(width===1440)await expect(groupList.getByRole("button",{name:/Редакторы/})).toBeVisible();
   await groupList.getByRole("button",{name:/Администраторы/}).click();
   const groupDialog=page.getByRole("dialog",{name:"Группы пользователей",exact:true});
   await expect(groupDialog.getByRole("heading",{name:"Администраторы",exact:true})).toBeVisible();
   await expect(groupDialog.getByText(me.name,{exact:true})).toBeVisible();
   await expect(groupDialog.getByLabel("Название",{exact:true})).toHaveCount(0);
   await groupDialog.getByRole("button",{name:"Пользователи",exact:true}).click();
   await expect(groupDialog.getByRole("heading",{name:"Пользователи",exact:true})).toBeVisible();
   await expect(groupDialog.getByText(me.name,{exact:true})).toHaveCount(0);
   await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-system-group-${width}.png`});
   await groupDialog.getByRole("button",{name:"Новая группа",exact:true}).click();
   await expect(groupDialog.getByLabel("Название",{exact:true})).toBeVisible();
   await groupDialog.getByRole("button",{name:"Администраторы",exact:true}).click();
   await groupDialog.getByRole("button",{name:"Управление пользователями",exact:true}).click();
   await expect(page).toHaveURL(`${base}/admin/users`);

  }
  assert.deepEqual(errors,[]);await expect(page.getByRole("alert")).toHaveCount(0);
  await context.close();console.log(`PASS settings navigation, profile deep link, legacy redirect and responsive layout ${role} ${width}px`);
 }
}finally{await browser.close();await server.close();}
