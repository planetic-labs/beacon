// Synthetic API: check placement and invitations without a microphone or live server.
import {chromium,expect} from '@playwright/test';
import {createServer} from '../apps/web/node_modules/vite/dist/node/index.js';
import {fileURLToPath} from 'node:url';
import {chatAction} from './message-menu';
const root=fileURLToPath(new URL('../apps/web/',import.meta.url));
const server=await createServer({root,configFile:root+'vite.config.ts',server:{host:'127.0.0.1',port:0}});await server.listen();
const base=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`;
const id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,'0')}`;
const me={id:id(1),name:'Тест Один',firstName:'Тест',lastName:'Один',role:'user',banned:false},peer={...me,id:id(2),name:'Тест Два'};
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{for(const width of [1440,390,320]){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage();let call:any=null;
 await context.route('**/socket.io/**',r=>r.abort());
 await context.route('**/api/**',async r=>{
  const path=new URL(r.request().url()).pathname;let data:unknown=[];
  if(path==='/api/v1/me')data=me;else if(path==='/api/v1/users')data=[me,peer];
  else if(path==='/api/v1/chats')data=[{id:id(3),kind:'direct',name:peer.name,peerId:peer.id,unread:0},{id:id(4),kind:'group',name:'Группа',ownerId:me.id,unread:0}];
  else if(path.endsWith('/messages'))data={messages:[],hasMore:false};
  else if(path==='/api/v1/calls'){
   if(r.request().method()==='POST'){call={id:id(5),chatId:id(3),callerId:me.id,status:'ringing',mode:r.request().postDataJSON().mode,participants:[me,peer]};data={id:call.id};}
   else data={configured:true,call};
  }else if(path.startsWith('/api/v1/calls/')){call=null;data={ok:true};}
  else if(path==='/api/push')data={configured:false};
  await r.fulfill({json:data});
 });
 await page.goto(`${base}/chats/${id(3)}`);await expect(page.locator('.chat-header-title')).toBeVisible();
 for(const name of ['Аудиозвонок','Видеозвонок']){
  await chatAction(page,name);const dialog=page.getByRole('dialog',{name,exact:true});await expect(dialog).toContainText('Вызываем');
  await dialog.getByRole('button',{name:'Отменить',exact:true}).click();await expect(dialog).toHaveCount(0);
 }
 call={id:id(6),chatId:id(3),callerId:peer.id,status:'ringing',mode:'audio',participants:[me,peer]};await page.evaluate(()=>window.dispatchEvent(new Event('beacon:calls-changed')));
 await expect(page.getByRole('dialog',{name:'Аудиозвонок',exact:true})).toContainText('Входящий');
 await page.getByRole('button',{name:'Отклонить',exact:true}).click();await expect(page.getByRole('dialog',{name:'Аудиозвонок',exact:true})).toHaveCount(0);
 await page.goto(`${base}/chats/${id(4)}`);await expect(page.locator('.chat-header-title')).toHaveText('Группа');await page.getByRole('button',{name:'Действия с чатом',exact:true}).click();
 await expect(page.getByRole('button',{name:'Аудиозвонок',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Видеозвонок',exact:true})).toHaveCount(0);
 await context.close();console.log(`PASS call placement, outgoing audio/video, incoming decline and personal-only actions ${width}px`);
}}finally{await browser.close();await server.close();}
