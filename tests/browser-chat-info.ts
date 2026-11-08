// Synthetic accounts and attachment catalogue; never touches the development database.
import {chromium,expect} from '@playwright/test';
import {createServer} from '../apps/web/node_modules/vite/dist/node/index.js';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../apps/web/',import.meta.url)),server=await createServer({root,configFile:root+'vite.config.ts',server:{host:'127.0.0.1',port:0}});await server.listen();
const base=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`,id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,'0')}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{for(const width of [390,320,1440]){
 if(process.env.CHAT_INFO_WIDTHS&&!process.env.CHAT_INFO_WIDTHS.split(",").map(Number).includes(width))continue;
 const context=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'}),page=await context.newPage(),errors:string[]=[];
 const me={id:id(1),name:'Тест Один',firstName:'Тест',lastName:'Один',role:'user',banned:false},peer={...me,id:id(2),name:'Анна Лесная',email:'private@example.com'};
 const chats=[{id:id(3),kind:'direct',name:peer.name,peerId:peer.id,muted:false,unread:0},{id:id(4),kind:'group',name:'Лесные прогулки',title:'Лесные прогулки',ownerId:me.id,unread:0}];let mute:unknown;
 page.on('pageerror',error=>errors.push(error.message));await context.route('**/socket.io/**',route=>route.abort());
 await context.route('**/media/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#8cb18f"/></svg>'}));
 await context.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url()),path=url.pathname;let data:unknown=[];
  if(path==='/api/v1/me')data=me;else if(path==='/api/v1/users')data=[me,peer];else if(path==='/api/v1/chats')data=chats;
  else if(path.endsWith('/members'))data={chat:{id:id(4),kind:'group',title:'Лесные прогулки',description:'Встречи и прогулки на природе',owner_id:me.id},members:[me,peer]};
  else if(path.endsWith('/attachments'))data={items:url.searchParams.get('kind')==='photo'?[{messageId:id(5),type:'photo',text:'',authorName:peer.name,createdAt:'2026-01-01T12:00:00Z',files:[1,2,3].map(n=>({id:id(5+n),mime:'image/png',size:100})),links:[]}]:[]};
  else if(path.startsWith('/api/push/chats/')){mute=request.postDataJSON();chats[0].muted=true;data={ok:true};}
  else if(path==='/api/push')data={configured:false,mutedChatIds:[]};
  await route.fulfill({json:data});
 });
 await page.goto(base+'/chats/'+id(3));await page.getByRole('button',{name:'Информация о переписке',exact:true}).click();
 const profile=page.getByRole(width>780?'region':'dialog',{name:'Профиль собеседника',exact:true});await expect(profile.getByRole('heading',{name:peer.name,exact:true})).toBeVisible();await expect(profile.getByText(peer.email,{exact:true})).toHaveCount(0);
 if(width>780){const workspace=await page.locator('.workspace').boundingBox(),info=await profile.boundingBox();assert.ok(workspace&&info&&Math.abs(workspace.x-info.x)<1&&Math.abs(workspace.width-info.width)<1&&Math.abs(workspace.height-info.height)<1,'profile fills the entire conversation area');await expect(page.locator('.chat-list')).toBeVisible();await expect(page.locator('.chat-info-backdrop')).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Сообщение',exact:true})).toBeHidden();}
 await expect(profile.locator('.attachment-photo-grid img')).toHaveCount(3);await expect(profile.getByRole('button',{name:'Звонок',exact:true})).toBeVisible();
 await profile.getByRole('button',{name:'Выключить звук',exact:true}).click();await expect(profile.getByRole('button',{name:'Включить звук',exact:true})).toBeVisible();assert.deepEqual(mute,{muted:true});
 await page.screenshot({path:`${process.env.SCREENSHOT_DIR??'/tmp'}/beacon-person-info-${width}.png`});
 await profile.getByRole('tab',{name:'Файлы',exact:true}).click();await expect(profile.getByText('Пока нет вложений этого типа')).toBeVisible();
 assert.ok(await profile.evaluate(node=>node.scrollWidth<=node.clientWidth));await profile.getByRole('button',{name:'Вернуться в чат',exact:true}).click();await expect(profile).toHaveCount(0);
 if(width>780){await page.getByRole('button',{name:'Информация о переписке',exact:true}).click();await page.locator('.chat-row').filter({hasText:'Лесные прогулки'}).click();await expect(profile).toHaveCount(0);await expect(page).toHaveURL(base+'/chats/'+id(4));}else await page.goto(base+'/chats/'+id(4));await page.getByRole('button',{name:'Информация о переписке',exact:true}).click();
 const group=page.getByRole(width>780?'region':'dialog',{name:'Информация о группе',exact:true});await expect(group.getByText('Встречи и прогулки на природе',{exact:true})).toBeVisible();await expect(group.getByRole('button',{name:'Открыть переписку: '+peer.name,exact:true})).toBeVisible();await expect(group.getByRole('button',{name:'Звонок',exact:true})).toHaveCount(0);
 await page.screenshot({path:`${process.env.SCREENSHOT_DIR??'/tmp'}/beacon-group-info-${width}.png`});assert.ok(await group.evaluate(node=>node.scrollWidth<=node.clientWidth));
 await group.getByRole('button',{name:'Участники и настройки группы',exact:true}).click();await expect(page.getByRole('dialog',{name:'Участники и настройки',exact:true})).toBeVisible();assert.deepEqual(errors,[]);
 await context.close();console.log(`PASS person/group profiles, privacy, notifications, attachments and management ${width}px`);
}}finally{await browser.close();await server.close();}
