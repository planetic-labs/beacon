// Real LiveKit + synthetic users in a disposable Beacon database. Force TURN/TLS.
import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chatAction} from './message-menu';
if(process.env.APP_ENV!=='test')throw new Error('Disposable test environment required');
const fixtures=JSON.parse(await readFile('/run/test/calls.json','utf8')),base=process.env.APP_URL!;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
try{
 for(const mode of ['audio','video'] as const){
  const contexts=[];
  for(const [index,user] of fixtures.users.entries()){
   const context=await browser.newContext({viewport:{width:index?390:1440,height:900},permissions:['microphone','camera'],serviceWorkers:'block'});
   await context.addCookies([{name:user.cookieName,value:user.cookieValue,url:base}]);
   await context.addInitScript(()=>{
    const Original=window.RTCPeerConnection;
    window.RTCPeerConnection=class extends Original{constructor(config?:RTCConfiguration){super({...config,iceTransportPolicy:'relay'});}};
   });
   await context.route('**/socket.io/**',r=>r.abort());contexts.push(context);
  }
  const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
  const [otherCaller,otherCallee]=await Promise.all(contexts.map(c=>c.newPage()));
  await Promise.all([a,b,otherCaller,otherCallee].map(p=>p.goto(`${base}/chats/${fixtures.directId}`)));
  for(const p of [a,b,otherCaller,otherCallee])await expect(p.locator('.chat-header-title')).toBeVisible();
  await chatAction(a,mode==='audio'?'Аудиозвонок':'Видеозвонок');
  const title=mode==='audio'?'Аудиозвонок':'Видеозвонок';
  await expect(a.getByRole('dialog',{name:title,exact:true})).toContainText('Вызываем');
  await otherCaller.evaluate(()=>window.dispatchEvent(new Event('beacon:calls-changed')));
  await expect(otherCaller.getByRole('dialog',{name:title,exact:true})).toHaveCount(0);
  await expect(b.getByRole('dialog',{name:title,exact:true})).toContainText('Входящий',{timeout:25000});
  await expect(otherCallee.getByRole('dialog',{name:title,exact:true})).toContainText('Входящий',{timeout:25000});
  await b.getByRole('button',{name:'Принять',exact:true}).click();
  await otherCallee.evaluate(()=>window.dispatchEvent(new Event('beacon:calls-changed')));
  await expect(otherCallee.getByRole('dialog',{name:title,exact:true})).toHaveCount(0,{timeout:10000});
  for(const p of [otherCaller,otherCallee])await expect(p.locator('.call-media audio,.call-media video')).toHaveCount(0);
  for(const p of [a,b]){
   const dialog=p.getByRole('dialog',{name:title,exact:true});
   await expect(dialog).toContainText('Соединение установлено',{timeout:30000});
   await expect.poll(()=>dialog.locator('audio').evaluateAll(nodes=>nodes.some(node=>node instanceof HTMLAudioElement&&node.srcObject instanceof MediaStream&&node.srcObject.getAudioTracks().some(track=>track.readyState==='live'))),{timeout:20000}).toBe(true);
   if(mode==='video')await expect.poll(()=>dialog.locator('video').evaluateAll(nodes=>nodes.filter(n=>n instanceof HTMLVideoElement&&n.videoWidth>0).length),{timeout:20000}).toBe(2);
  }
  await a.getByRole('button',{name:'Выключить микрофон',exact:true}).click();await expect(a.getByRole('button',{name:'Включить микрофон',exact:true})).toBeVisible();
  if(mode==='video'){await b.getByRole('button',{name:'Выключить камеру',exact:true}).click();await expect(b.getByRole('button',{name:'Включить камеру',exact:true})).toBeVisible();}
  await a.getByRole('button',{name:'Завершить',exact:true}).click();await expect(a.getByRole('dialog',{name:title,exact:true})).toHaveCount(0);
  await expect(b.getByRole('dialog',{name:title,exact:true})).toHaveCount(0,{timeout:25000});
  await a.goto(`${base}/chats/${fixtures.chatId}`);await a.getByRole('button',{name:'Действия с чатом',exact:true}).click();
  assert.equal(await a.getByRole('button',{name:'Аудиозвонок',exact:true}).count(),0,'group calls are not exposed');
  for(const context of contexts)await context.close();console.log(`PASS ${mode} personal call, real TURN/TLS media, controls and hangup`);
 }
}finally{await browser.close();}
