import {chromium,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {createECDH,randomBytes} from "node:crypto";
import {v7} from "uuid";
const base=process.env.APP_URL!;
const fixture=JSON.parse(await readFile("/run/test/browser.json","utf8"));
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
try {
  const context=await browser.newContext({permissions:["notifications"],viewport:{width:1440,height:900}});
  // tsx preserves names in serialized nested mock functions using this helper.
  await context.addInitScript("window.__name = (fn) => fn;");
  const recipient=fixture.users[1],sender=fixture.users[0];
  await context.addCookies([{name:recipient.cookieName,value:recipient.cookieValue,url:base}]);
  const defaults=await context.request.patch(`${base}/api/push`,{headers:{origin:base},data:{enabled:true,showPreview:false}});
  expect(defaults.status()).toBe(200);
  const ecdh=createECDH("prime256v1");ecdh.generateKeys();
  const mock={endpoint:`https://fcm.googleapis.com/fcm/send/browser-test-${v7()}`,
    keys:{p256dh:ecdh.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url")}};
  // Headless Chromium has no vendor push account. Mock only device registration;
  // the backend API, real service worker and OS notification API are exercised.
  await context.addInitScript((input)=>{
    let subscription:PushSubscription|null=null;
    PushManager.prototype.getSubscription=async()=>subscription;
    PushManager.prototype.subscribe=async(options)=>{
      subscription={endpoint:input.endpoint,expirationTime:null,getKey:()=>null,
        options:{userVisibleOnly:true,applicationServerKey:new Uint8Array(options!.applicationServerKey as Uint8Array).buffer},
        toJSON:()=>({...input,expirationTime:null}),unsubscribe:async()=>{subscription=null;return true}};
      return subscription;
    };
  },mock);
  const page=await context.newPage();
  await page.route("**/socket.io/**",route=>route.abort());
  const cdp=await context.newCDPSession(page);
  let registrationId="";
  cdp.on("ServiceWorker.workerRegistrationUpdated",({registrations})=>{
    for(const item of registrations)if(item.scopeURL===`${base}/`&&!item.isDeleted)registrationId=item.registrationId;
  });
  await cdp.send("ServiceWorker.enable");
  await page.goto(base,{waitUntil:"domcontentloaded"});
  await page.locator(".nav-rail").getByRole("button",{name:"Настройки",exact:true}).click();
  await page.getByRole("navigation",{name:"Разделы настроек"}).getByRole("button",{name:"Push-уведомления",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Push-уведомления",exact:true,level:2})).toBeVisible();
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/push/subscriptions"&&r.request().method()==="POST");
  void saved.catch(()=>{});
  await page.getByRole("button",{name:"Включить уведомления",exact:true}).click();
  await page.waitForTimeout(500);
  const early=await page.locator(".notice.error").allTextContents();
  if(early.length)throw new Error(early.join("; "));
  await expect(page.getByRole("status")).toContainText("На этом устройстве включены",{timeout:10000});
  const result=await saved;expect(result.status()).toBe(200);
  const {id:subscriptionId}=await result.json();
  await expect(page.getByRole("status")).toContainText("На этом устройстве включены");
  await expect.poll(()=>registrationId,{timeout:15000}).not.toBe("");
  const senderContext=await browser.newContext();
  await senderContext.addCookies([{name:sender.cookieName,value:sender.cookieValue,url:base}]);
  async function send(text:string){
    const response=await senderContext.request.post(`${base}/api/v1/chats/${fixture.chatId}/messages`,{
      headers:{origin:base},data:{text,clientMessageId:v7()}});
    expect(response.status()).toBe(200);return (await response.json()).id;
  }
  async function push(messageId:string){
    await cdp.send("ServiceWorker.deliverPushMessage",{origin:base,registrationId,
      data:JSON.stringify({type:"message",subscriptionId,messageId,chatId:fixture.chatId})});
  }
  async function notifications(){
    return page.evaluate(async()=>{
      const worker=await navigator.serviceWorker.ready;
      return (await worker.getNotifications()).map(n=>({title:n.title,body:n.body,tag:n.tag}));
    });
  }
  const first=await send("Проверка приватного push");await push(first);
  await expect.poll(async()=>(await notifications()).length,{timeout:15000}).toBe(1);
  expect((await notifications())[0].title).toBe("Beacon");
  expect((await notifications())[0].body).not.toContain("Проверка приватного");
  const changed=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/push"&&r.request().method()==="PATCH");
  await page.getByLabel("Показывать имя отправителя и текст сообщения").check();await changed;
  const second=await send("Теперь текст виден");await push(second);
  await expect.poll(async()=>(await notifications())[0]?.body,{timeout:15000}).toContain("Теперь текст виден");
  await page.getByRole("button",{name:"Отключить на этом устройстве",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("На этом устройстве выключены");
  expect((await notifications()).length).toBe(0);
  await push(second);await page.waitForTimeout(500);
  expect((await notifications()).length).toBe(0);
  await page.goto(`${base}/?chat=${fixture.chatId}`,{waitUntil:"domcontentloaded"});
  await expect(page.locator(".chat-header-title")).toHaveText("Чат для технических моментов");
  await expect(page.locator(".bubble-text",{hasText:"Теперь текст виден"})).toBeVisible();
  await page.getByRole("button",{name:"Отключить push в этом чате",exact:true}).click();
  await expect(page.getByRole("button",{name:"Включить push в этом чате",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Включить push в этом чате",exact:true}).click();
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    await expect(page.locator(".app")).toHaveAttribute("data-device","mobile");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  console.log("INFO browser push checks passed: opt-in, real service-worker notifications, privacy, preview, opt-out, deep link and chat mute");
} catch(error) {
  for(const context of browser.contexts())for(const page of context.pages()){
    console.log("Push test state",await page.locator(".notice.error").allTextContents());
    await page.screenshot({path:"/run/test/push-failure.png"}).catch(()=>{});
  }
  throw error;
} finally {await browser.close()}
