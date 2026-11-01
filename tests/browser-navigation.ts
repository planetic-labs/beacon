// Synthetic navigation fixtures never access development accounts.
import {chromium,expect} from '@playwright/test';
import {createServer} from '../apps/web/node_modules/vite/dist/node/index.js';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../apps/web',import.meta.url)),server=await createServer({root,configFile:root+'/vite.config.ts',server:{host:'127.0.0.1',port:0}});await server.listen();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{for(const role of ["admin","user"])for(const width of [390,320,1440]){
 const context=await browser.newContext({viewport:{width,height:800},serviceWorkers:'block'}),page=await context.newPage();
 await context.route('**/socket.io/**',r=>r.abort());
 await context.route('**/api/**',r=>{const p=new URL(r.request().url()).pathname;return r.fulfill({json:p==='/api/v1/me'?{id:'019a0000-0000-7000-8000-000000000001',name:'Тестовый Пользователь',firstName:'Тестовый',lastName:'Пользователь',role}:p==='/api/push'?{configured:false}:[]});});
 await page.goto('http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port+'/');
 await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content','#f7f8fb');
 const nav=page.getByRole('navigation',{name:'Навигация',exact:true});
 if(width<780){await expect(nav).toBeVisible();const box=await nav.boundingBox();assert.ok(box&&box.x>=9&&box.x+box.width<=width-9&&box.y+box.height<=791);await expect(nav.getByRole('button')).toHaveCount(5);assert.equal(await nav.evaluate(n=>getComputedStyle(n).borderRadius),'34px');}else await expect(nav).toBeHidden();
 await expect(page.getByRole('heading',{name:'Чаты',exact:true})).toBeVisible();
 if(width<780){
  await expect(nav.getByRole('button')).toHaveText(['Главная','Материалы','Чаты','Хранилище','Ещё']);
  await expect(nav.getByRole('button',{name:'Чаты',exact:true})).toHaveAttribute('aria-current','page');
  await nav.getByRole('button',{name:'Главная',exact:true}).click();
 }else await page.locator('.nav-rail').getByRole('button',{name:'Главная',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Главная',exact:true})).toBeVisible();
 await expect(page.locator('.home-materials .mv-video')).toHaveCount(3);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:(process.env.SCREENSHOT_DIR??'/tmp')+'/beacon-home-'+role+'-'+width+'.png'});
 await page.getByRole('button',{name:'Перейти к общению',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Чаты',exact:true})).toBeVisible();
 if(width<780){
  await nav.getByRole('button',{name:'Ещё',exact:true}).click();
 }else await page.goto('http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port+'/more');
 await expect(page.getByRole('heading',{name:'Ещё',exact:true})).toBeVisible();
 const links=page.getByRole('navigation',{name:'Дополнительные разделы'});
 await expect(links.getByRole('button',{name:'Администрирование',exact:true})).toHaveCount(role==='admin'?1:0);
 await expect(links.getByRole('button',{name:'Мои стикеры',exact:true})).toBeVisible();
 const avatar=await page.locator('.more-profile .avatar').boundingBox();assert.ok(avatar&&Math.abs(avatar.width-avatar.height)<1);
 await page.screenshot({path:(process.env.SCREENSHOT_DIR??'/tmp')+'/beacon-more-'+role+'-'+width+'.png'});
 await links.getByRole('button',{name:'Настройки',exact:true}).click();
 await expect(page).toHaveURL(/\/settings$/);
 await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content','#f6f7fb');
 if(width<780){await page.getByRole('button',{name:'Назад в Ещё',exact:true}).click();await expect(page).toHaveURL(/\/more$/);}
 else await page.goBack();
 await page.getByRole('button',{name:/Мой профиль/}).click();
 await expect(page).toHaveURL(/\/settings\/profile$/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:(process.env.SCREENSHOT_DIR??'/tmp')+'/beacon-bottom-nav-'+width+'.png'});await context.close();console.log('PASS navigation '+width);
}}finally{await browser.close();await server.close();}
