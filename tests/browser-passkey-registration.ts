// Real WebAuthn browser ceremony with a disposable virtual authenticator;
// server routes are synthetic and never create keys for development users.
import { chromium, expect } from "@playwright/test";
import { createServer } from "../apps/web/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url));
const server=await createServer({root,configFile:`${root}/vite.config.ts`,server:{host:"127.0.0.1",port:0}});
await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==="string")throw new Error("Missing server address");
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox"]});
try {
 for(const width of [1440,390]) {
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
 const cdp=await context.newCDPSession(page);
 await cdp.send("WebAuthn.enable");
 await cdp.send("WebAuthn.addVirtualAuthenticator",{options:{protocol:"ctap2",transport:"internal",hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 let verified=false,optionsCalls=0,fresh=false,sent=0,attempts=0;
 const me={id:"019a0000-0000-7000-8000-000000000001",name:"Test User",firstName:"Test",lastName:"User",email:"user@example.com",role:"user",banned:false};
 await context.route("**/socket.io/**",route=>route.abort());
 await context.route("**/api/**",async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith("/generate-register-options")){
   optionsCalls++;
   if(!fresh){await route.fulfill({status:403,json:{code:"SESSION_NOT_FRESH",message:"Session is not fresh"}});return;}
   await route.fulfill({json:{challenge:"dGVzdC1yZWdpc3RyYXRpb24tY2hhbGxlbmdl",rp:{name:"Beacon",id:"localhost"},user:{id:"dGVzdC11c2Vy",name:me.email,displayName:me.name},pubKeyCredParams:[{type:"public-key",alg:-7}],authenticatorSelection:{residentKey:"required",userVerification:"preferred"},attestation:"none",timeout:60000}});return;
  }
  if(path.endsWith("/send-verification-otp")){
   assert.equal(route.request().postDataJSON().email,me.email);sent++;
   if(sent===1){await route.fulfill({status:500,json:{code:"SEND_FAILED"}});return;}
   await route.fulfill({json:{success:true}});return;
  }
  if(path.endsWith("/sign-in/email-otp")){
   const body=route.request().postDataJSON();assert.equal(body.email,me.email);attempts++;
   if(body.otp!=="123456"){await route.fulfill({status:400,json:{code:"INVALID_OTP"}});return;}
   fresh=true;await route.fulfill({json:{user:me}});return;
  }
  if(path.endsWith("/verify-registration")){
   const body=route.request().postDataJSON();assert.ok(body.response.response.attestationObject);assert.ok(body.name);assert.equal(body.response.clientExtensionResults,undefined);verified=true;
   await route.fulfill({json:{id:"test-key",name:body.name}});return;
  }
  await route.fulfill({json:path==="/api/v1/me"?me:path==="/api/v1/users"?[me]:path.endsWith("/list-user-passkeys")?(verified?[{id:"test-key",name:"Test device"}]:[]):[]});
 });
 await page.goto(`http://localhost:${address.port}/settings/security`);
 await page.getByRole("button",{name:"Добавить ключ доступа",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:"Подтвердите, что это вы"});
 await expect(dialog).toBeVisible();
 await dialog.getByRole("button",{name:"Отмена",exact:true}).click();
 await expect(dialog).toHaveCount(0);assert.equal(sent,0);assert.equal(verified,false);
 await expect(page.getByRole("heading",{name:"Ключи доступа",exact:true}).last()).toBeVisible();
 await page.getByRole("button",{name:"Добавить ключ доступа",exact:true}).click();
 await dialog.getByRole("button",{name:"Отправить код",exact:true}).click();
 await expect(dialog.getByRole("alert")).toContainText("Не удалось отправить код");
 await dialog.getByRole("button",{name:"Отправить код",exact:true}).click();
 await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-reauth-code-${width}.png`});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await dialog.getByLabel("Код подтверждения").fill("000000");
 await dialog.getByRole("button",{name:"Подтвердить",exact:true}).click();
 await expect(dialog.getByRole("alert")).toContainText("Код неверен");assert.equal(fresh,false);
 await dialog.getByLabel("Код подтверждения").fill("123456");
 await dialog.getByRole("button",{name:"Подтвердить",exact:true}).click();
 await expect(dialog.getByRole("button",{name:"Продолжить создание ключа"})).toBeVisible();
 assert.equal(verified,false,"email confirmation must not automatically open WebAuthn");
 await dialog.getByRole("button",{name:"Продолжить создание ключа"}).click();
 await expect(page.getByText("Test device",{exact:true})).toBeVisible();
 await expect(dialog).toHaveCount(0);
 assert.equal(optionsCalls,3);assert.equal(attempts,2);assert.ok(verified);
 console.log("PASS native options request, real browser registration, server verification and key list refresh");
 await context.close();
 }
} finally {await browser.close();await server.close();}
