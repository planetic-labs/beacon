// Synthetic community only; never creates groups in the working deployment.
import {chromium,expect} from '@playwright/test';
import {createServer} from '../apps/web/node_modules/vite/dist/node/index.js';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../apps/web/',import.meta.url));
const server=await createServer({root,configFile:root+'vite.config.ts',server:{host:'127.0.0.1',port:0}});await server.listen();
const base=`http://127.0.0.1:${(server.httpServer!.address() as {port:number}).port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const id=(n:number)=>`019a0000-0000-7000-8000-${String(n).padStart(12,'0')}`;
try{for(const width of [390,320,1440]){
 const context=await browser.newContext({viewport:{width,height:800},hasTouch:width<781,isMobile:width<781,serviceWorkers:'block'}),page=await context.newPage(),errors:string[]=[];
 const me={id:id(1),name:'Тест Один',firstName:'Тест',lastName:'Один',role:'user',banned:false};
 const users=[me,{...me,id:id(2),name:'Анна Лесная'},{...me,id:id(3),name:'Борис Озёрный'},{...me,id:id(4),name:'Недоступный',banned:true}];
 let sent:unknown;const chats:unknown[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/socket.io/**',route=>route.abort());
 await context.route('**/api/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;let data:unknown=[];
  if(path==='/api/v1/me')data=me;
  else if(path==='/api/v1/users')data=users;
  else if(path==='/api/v1/chats'){
   if(request.method()==='POST'){sent=request.postDataJSON();chats.push({id:id(5),name:'Лесные прогулки',title:'Лесные прогулки',kind:'group',ownerId:me.id,unread:0});data={id:id(5)};}else data=chats;
  }else if(path.endsWith('/members'))data={members:users.slice(0,3),chat:{id:id(5),kind:'group'}};
  else if(path==='/api/push')data={configured:false};
  await route.fulfill({json:data});
 });
 await page.goto(base);if(width<781)assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('-webkit-tap-highlight-color')),'rgba(0, 0, 0, 0)');await page.getByRole('button',{name:'Меню списка чатов',exact:true}).click();await page.getByRole('menuitem',{name:'Создать группу',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Создать группу',exact:true}),submit=dialog.getByRole('button',{name:'Создать группу',exact:true}),next=dialog.getByRole('button',{name:'Далее',exact:true});
 await page.screenshot({path:`${process.env.SCREENSHOT_DIR??'/tmp'}/beacon-new-group-people-${width}.png`});
 if(width<781){
  // The keyboard shrinks the visual viewport without resizing the layout viewport.
  await page.evaluate(async()=>{const viewport=window.visualViewport!;Object.defineProperty(viewport,'height',{configurable:true,value:360});Object.defineProperty(viewport,'offsetTop',{configurable:true,value:20});viewport.dispatchEvent(new Event('resize'));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const bounds=await page.locator('.new-group-dialog').boundingBox();assert.ok(bounds&&bounds.y>=20&&bounds.y+bounds.height<=380,'dialog stays above keyboard');
  await page.screenshot({path:`${process.env.SCREENSHOT_DIR??'/tmp'}/beacon-new-group-keyboard-${width}.png`});
  await page.evaluate(async()=>{const viewport=window.visualViewport!;Reflect.deleteProperty(viewport,'height');Reflect.deleteProperty(viewport,'offsetTop');viewport.dispatchEvent(new Event('resize'));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 }
 await expect(dialog.getByRole('combobox')).toHaveCount(0);await expect(dialog.getByRole('checkbox')).toHaveCount(0);await expect(next).toBeDisabled();await expect(submit).toHaveCount(0);await expect(dialog.getByRole('textbox',{name:'Название группы',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:me.name,exact:true})).toHaveCount(0);await expect(dialog.getByText('Недоступный',{exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Анна Лесная',exact:true}).locator('.avatar')).toHaveCount(1);
 await dialog.getByRole('button',{name:'Анна Лесная',exact:true}).click();await expect(dialog.getByRole('button',{name:'Убрать Анна Лесная',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Анна Лесная',exact:true})).toHaveCount(0);
 const search=dialog.getByRole('searchbox',{name:'Найти участника'});await search.fill('бор');await search.press('Enter');await expect(search).toBeFocused();await expect(search).toHaveValue('бор');assert.equal(sent,undefined);await expect(dialog.getByRole('button',{name:'Анна Лесная',exact:true})).toHaveCount(0);const boris=dialog.getByRole('button',{name:'Борис Озёрный',exact:true});if(width<781)await boris.tap();else await boris.click();
 await expect(search).toHaveValue('');await expect(search).toBeFocused();await expect(dialog.getByRole('button',{name:'Борис Озёрный',exact:true})).toHaveCount(0);await expect(dialog.getByText('Все участники выбраны.',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Убрать Анна Лесная',exact:true}).click();await search.fill('нет такого');await expect(dialog.getByText('Никого не нашли. Попробуйте другое имя.')).toBeVisible();await search.fill('');await dialog.getByRole('button',{name:'Анна Лесная',exact:true}).click();
 await dialog.getByRole('button',{name:'Убрать Анна Лесная',exact:true}).click();await expect(dialog.getByRole('button',{name:'Анна Лесная',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Анна Лесная',exact:true}).click();
 await expect(next).toBeEnabled();assert.equal(sent,undefined);
 await page.screenshot({path:`${process.env.SCREENSHOT_DIR??'/tmp'}/beacon-group-members-selected-${width}.png`});
 await next.click();await expect(search).toHaveCount(0);await expect(submit).toBeDisabled();
 await dialog.getByRole('textbox',{name:'Название группы',exact:true}).fill('  Лесные прогулки  ');
 const nameInput=dialog.getByRole('textbox',{name:'Название группы',exact:true});await expect(nameInput).toHaveAttribute('enterkeyhint','done');await nameInput.press('Enter');await expect(nameInput).not.toBeFocused();await expect(search).toHaveCount(0);await expect(dialog).toBeVisible();assert.equal(sent,undefined);await expect(nameInput).toHaveValue('  Лесные прогулки  ');
 await expect(dialog.locator('.new-group-members .avatar')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Назад к участникам',exact:true}).click();await expect(dialog.getByRole('button',{name:'Убрать Анна Лесная',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Убрать Борис Озёрный',exact:true})).toBeVisible();await next.click();await expect(nameInput).toHaveValue('  Лесные прогулки  ');
 assert.ok(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`${process.env.SCREENSHOT_DIR??'/tmp'}/beacon-new-group-${width}.png`});
 await submit.click();await expect(dialog).toHaveCount(0);await expect(page).toHaveURL(base+'/chats/'+id(5));
 assert.deepEqual(sent,{kind:'group',title:'Лесные прогулки',userIds:[id(3),id(2)]});assert.deepEqual(errors,[]);
 await context.close();console.log(`PASS group-only creation, member tags, search and submission ${width}px`);
}}finally{await browser.close();await server.close();}
