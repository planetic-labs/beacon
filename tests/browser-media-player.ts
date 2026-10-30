// Isolated media fixtures; never changes development users or messages.
import { chromium, expect } from "@playwright/test";
import { createServer } from "../apps/web/node_modules/vite/dist/node/index.js";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../apps/web/",import.meta.url));
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MediaPlayer} from '/src/components/media-player.tsx';
import {renderMessage} from '/src/components/message-types.tsx';
window.events=[];
createRoot(document.getElementById('root')).render(React.createElement('main',null,
React.createElement(MediaPlayer,{src:'/demo/flower.mp4',title:'Материал',pauseWhenHidden:true,onPlaybackEvent:e=>window.events.push(e)}),
React.createElement('section',{id:'chat'},renderMessage('video',{fileId:'fixture',mime:'video/mp4',name:'Видео в чате'})),
React.createElement(MediaPlayer,{kind:'audio',src:'/demo/flower.mp4',title:'Аудио'})));
`;
const server=await createServer({root,configFile:`${root}/vite.config.ts`,plugins:[{
 name:"media-test-page",
 resolveId(id){if(id==="/media-test-entry.js")return "\0media-test-entry.js";},
 load(id){if(id==="\0media-test-entry.js")return entry;},
 configureServer(server){server.middlewares.use("/__media-test",async (_request,response)=>{
  response.setHeader("Content-Type","text/html");
  response.end(await server.transformIndexHtml("/__media-test",'<!doctype html><html><body><div id="root"></div><script type="module" src="/media-test-entry.js"></script></body></html>'));
 });}
}],server:{host:"127.0.0.1",port:0}});
await server.listen();const address=server.httpServer!.address();if(!address||typeof address==="string")throw new Error("No test server");
const browser=await chromium.launch({executablePath:"/usr/bin/chromium",args:["--no-sandbox","--autoplay-policy=no-user-gesture-required"]});
try {
 const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage(),errors:string[]=[];
 page.on("pageerror",error=>{errors.push(error.message);console.error(error.message);});
 await page.route("**/media/fixture",async route=>{const response=await route.fetch({url:`http://127.0.0.1:${address.port}/demo/flower.mp4`});await route.fulfill({response});});
 await page.goto(`http://127.0.0.1:${address.port}/__media-test`);
 await expect(page.locator("video")).toHaveCount(2,{timeout:20000});await expect(page.locator("audio")).toHaveCount(1);
 const videos=page.locator("video");
 await videos.nth(0).evaluate((v:HTMLVideoElement)=>v.play());
 await expect.poll(()=>videos.nth(0).evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(.1);
 await videos.nth(0).evaluate((v:HTMLVideoElement)=>{v.currentTime=2;});
 await expect.poll(()=>page.evaluate(()=>(window as any).events.some((e:any)=>e.type==="seeked"))).toBe(true);
 await videos.nth(1).evaluate((v:HTMLVideoElement)=>v.play());
 await expect.poll(()=>videos.nth(0).evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
 await page.locator("audio").evaluate((v:HTMLAudioElement)=>v.play());
 await expect.poll(()=>videos.nth(1).evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
 await videos.nth(0).evaluate((v:HTMLVideoElement)=>v.play());
 await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));});
 await expect.poll(()=>videos.nth(0).evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
 await page.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,value:false});document.dispatchEvent(new Event("visibilitychange"));});
 await expect.poll(()=>videos.nth(0).evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
 for (const width of [390,1440]) {
  await page.setViewportSize({width,height:900});
  const box=await videos.nth(0).boundingBox();
  expect(box!.height).toBeLessThan(box!.width*.65);
 }
 await page.setViewportSize({width:390,height:900});
 await page.screenshot({path:`${process.env.SCREENSHOT_DIR??"/tmp"}/beacon-media-mobile.png`});
 expect(errors).toEqual([]);
 await context.close();console.log("PASS material/chat/audio playback, progress, seeking, exclusive playback and visibility pause");
}finally{await browser.close();await server.close();}
