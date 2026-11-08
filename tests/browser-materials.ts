// Synthetic users, files and API only; never modifies the running dev.
import {chromium,expect} from '@playwright/test';
import {createServer} from '../apps/web/node_modules/vite/dist/node/index.js';
import {fileURLToPath} from 'node:url';import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {materialCatalogFixture,materialFixture,materialId} from './materials-fixtures';
const root=fileURLToPath(new URL('../apps/web/',import.meta.url)),server=await createServer({root,configFile:root+'vite.config.ts',server:{host:'127.0.0.1',port:0}});await server.listen();
const base='http://127.0.0.1:'+(server.httpServer!.address() as {port:number}).port,bytes=await readFile(new URL('../apps/web/public/demo/flower.mp4',import.meta.url));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const shots=process.env.SCREENSHOT_DIR??'/tmp';
async function scenario(role:string,width:number,manage=false){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors:string[]=[],progress:any[]=[];
 const data=materialCatalogFixture();data.materials[1]={...data.materials[1],kind:'audio',mime:'audio/mpeg'};data.materials[2]={...data.materials[2],kind:'document',mime:'text/plain',duration:0,chapters:[]};
 const folderId=materialId(20),spaceId=materialId(90);let folderEnabled=!manage,virtuals:any[]=[],saved=false;
 const node=(m:ReturnType<typeof materialFixture>)=>({id:m.id,space_id:spaceId,parent_id:folderId,name:m.fileName,directory:false,state:'ready',size:m.size,mime:m.mime,favorite:false,updated_at:m.updatedAt,sha256:null,hash_state:'none'});
 const folder={id:folderId,space_id:spaceId,parent_id:null,name:'Папка записей',directory:true,state:'ready',size:0,mime:'application/octet-stream',favorite:false,updated_at:'2026-01-01T12:00:00Z'};
 page.on('pageerror',e=>errors.push(e.message));await context.route('**/socket.io/**',r=>r.abort());
 await context.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;let value:unknown=[];
  if(p==='/api/v1/me')value={id:materialId(100),name:'Тест Пользователь',firstName:'Тест',lastName:'Пользователь',role};
  else if(p==='/api/push')value={configured:false};
  else if(p==='/api/materials')value=manage?{materials:folderEnabled?data.materials:[],playlists:[...(folderEnabled?[{id:folderId,name:folder.name,kind:'folder',materialIds:data.materials.map(m=>m.id)}]:[]),...virtuals.filter(p=>p.enabled)],checking:0}:data;
  else if(p==='/api/storage/spaces')value=[{id:spaceId,name:'Тестовое хранилище',owner_id:null}];
  else if(p==='/api/storage')value={nodes:url.searchParams.get('parentId')===folderId?data.materials.map(node):[folder],breadcrumbs:url.searchParams.has('parentId')?[{id:folderId,name:folder.name}]:[],canWrite:true,nextOffset:null};
  else if(p==='/api/storage/playlists'){if(req.method()==='POST'){const v=req.postDataJSON();virtuals.push({...v,id:materialId(33),kind:'virtual',files:v.materialIds.map((id:string)=>({id,name:data.materials.find(m=>m.id===id)!.fileName}))});value={id:materialId(33)};}else value=virtuals;}
  else if(p===`/api/storage/${folderId}/playlist`){if(req.method()==='PUT')folderEnabled=req.postDataJSON().enabled;value={folderId,enabled:folderEnabled};}
  else if(p.endsWith('/progress')){progress.push(req.postDataJSON());value={ok:true};}
  else if(p.endsWith('/card')&&p.startsWith('/api/storage/')){const id=p.split('/')[3],m=data.materials.find(m=>m.id===id)!;if(req.method()==='PUT'){Object.assign(m,req.postDataJSON());saved=true;value={id};}else value={...m,canWrite:true};}
  else if(p.endsWith('/content')){const id=p.split('/')[3],m=data.materials.find(m=>m.id===id);if(m?.kind==='document'){await route.fulfill({contentType:'text/plain',body:'Текст документа'});return;}const match=req.headers().range?.match(/^bytes=(\\d+)-(\\d*)$/),start=match?Number(match[1]):0,end=match?.[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;await route.fulfill({status:match?206:200,headers:{'content-type':'video/mp4','accept-ranges':'bytes','content-length':String(end-start+1),...(match?{'content-range':`bytes ${start}-${end}/${bytes.length}`}:{})},body:bytes.subarray(start,end+1)});return;}
  else if(p.startsWith('/api/materials/'))value=data.materials.find(m=>m.id===p.split('/')[3]);
  else if(p.startsWith('/api/storage/'))value=data.materials.map(node).find(n=>n.id===p.split('/')[3])??[];
  await route.fulfill({json:value});
 });
 if(!manage){
  await page.goto(base+'/materials/'+materialId(1)+'?t=2');await expect(page.getByRole('heading',{name:'Материал 1',exact:true})).toBeVisible();
  const video=page.locator('.beacon-media video');await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(1.8);
  await page.getByRole('region',{name:'Оглавление'}).getByRole('button',{name:/Основная часть/}).click();await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(2.8);
  await video.evaluate((v:HTMLVideoElement)=>v.play());await video.evaluate((v:HTMLVideoElement)=>v.pause());await expect.poll(()=>progress.length).toBeGreaterThan(0);
  await expect(page.getByRole('button',{name:'Редактировать материал',exact:true})).toHaveCount(0);await expect(page.getByRole('region',{name:'Дополнительные материалы'})).toHaveCount(0);
  await page.screenshot({path:`${shots}/beacon-file-material-${role}-${width}.png`});
  await page.getByRole('button',{name:'К материалам',exact:true}).click();await expect(page.locator('.mv-video-grid .mv-video')).toHaveCount(3);
  if(width<780)await page.getByRole('button',{name:'Открыть меню материалов',exact:true}).click();
  await page.getByRole('navigation',{name:'Плейлисты',exact:true}).getByRole('button',{name:/Встречи/}).click();await expect(page.locator('.mv-video-grid .mv-video')).toHaveCount(2);await expect(page.locator('.mv-video-grid h3').first()).toHaveText('Материал 2');
  await page.locator('.mv-video-grid .mv-cover').first().click();await expect(page.locator('.beacon-media.is-audio')).toBeVisible();await expect(page.locator('.beacon-media audio')).toHaveCount(1);
  await page.goto(base+'/materials/'+materialId(3));await expect(page.getByText('Текст документа',{exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Скачать файл',exact:true})).toHaveAttribute('href','/api/materials/'+materialId(3)+'/content?download=1');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }else{
  await page.goto(base+'/storage');await expect(page.getByRole('button',{name:'Папка записей',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Действия: Папка записей',exact:true}).click();await page.getByRole('menuitem',{name:'Папка как плейлист',exact:true}).click();const folderDialog=page.getByRole('dialog',{name:'Папка как плейлист',exact:true});await folderDialog.getByRole('button',{name:'Показывать как плейлист',exact:true}).click();await expect(folderDialog).toHaveCount(0);assert.equal(folderEnabled,true);
  await page.getByRole('button',{name:'Папка записей',exact:true}).click();await page.getByRole('button',{name:'Действия: 1.mp4',exact:true}).click();await page.getByRole('menuitem',{name:'Карточка файла',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Карточка файла',exact:true});await editor.getByLabel('Название',{exact:true}).fill('Карточка из хранилища');await editor.getByLabel('Время',{exact:true}).fill('0:01');await editor.getByLabel('Название главы',{exact:true}).fill('Новая глава');await editor.getByRole('button',{name:'Добавить тайм-код',exact:true}).click();await expect(editor.getByRole('button',{name:'Удалить главу Новая глава',exact:true})).toBeVisible();
  await page.screenshot({path:`${shots}/beacon-storage-card-${width}.png`});await editor.getByRole('button',{name:'Сохранить карточку',exact:true}).click();await expect(editor).toHaveCount(0);assert.ok(saved);assert.equal(data.materials[0].chapters.length,3);
  if(width<780)await page.getByRole('button',{name:'Открыть меню хранилища',exact:true}).click();
  await page.getByRole('button',{name:'Создать виртуальный плейлист',exact:true}).click();const virtual=page.getByRole('dialog',{name:'Создать виртуальный плейлист',exact:true});await virtual.getByLabel('Название плейлиста',{exact:true}).fill('Подборка');await virtual.getByRole('button',{name:'Папка записей',exact:true}).click();await virtual.getByRole('checkbox',{name:'1.mp4',exact:true}).check();await virtual.getByRole('checkbox',{name:'2.mp4',exact:true}).check();await virtual.getByRole('button',{name:'Выше 2',exact:true}).click();await virtual.getByRole('checkbox',{name:/Показывать в материалах/}).check();await page.screenshot({path:`${shots}/beacon-virtual-playlist-${width}.png`});await virtual.getByRole('button',{name:'Сохранить плейлист',exact:true}).click();await expect(virtual).toHaveCount(0);assert.deepEqual(virtuals[0].materialIds,[materialId(2),materialId(1)]);
  await page.goto(base+'/materials');await expect(page.locator('.mv-video-grid .mv-video')).toHaveCount(3);await expect(page.locator('.mv-video-grid h3').filter({hasText:'Карточка из хранилища'})).toHaveCount(1);
  await page.goto(base+'/materials/'+materialId(1));await expect(page.getByRole('heading',{name:'Карточка из хранилища',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Оглавление'})).toContainText('Новая глава');await page.getByRole('button',{name:'Карточка в хранилище',exact:true}).click();await expect(page.getByRole('dialog',{name:'Карточка файла',exact:true})).toBeVisible();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${manage?'storage cards/folder and virtual playlists':'read-only multi-kind materials'} ${role} ${width}`);
}
try{for(const role of ['admin','user'])for(const width of [1440,390,320])await scenario(role,width);for(const width of [1440,390,320])await scenario('admin',width,true);}finally{await browser.close();await server.close();}
