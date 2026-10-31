// Synthetic API responses exercise responsive UI without touching development data.
import { chromium,expect } from '@playwright/test';
import { createServer } from '../apps/web/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../apps/web/',import.meta.url));
const server=await createServer({root,configFile:`${root}/vite.config.ts`,server:{host:'127.0.0.1',port:0}});await server.listen();
const address=server.httpServer!.address();if(!address||typeof address==='string')throw new Error('No port');
const base=`http://127.0.0.1:${address.port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const me={id:'019a0000-0000-7000-8000-000000000001',name:'Тестовый пользователь',firstName:'Тестовый',lastName:'Пользователь',email:'user@example.com',banned:false,role:'admin'};
const space={id:'019a0000-0000-7000-8000-000000000002',name:'Домашнее',owner_id:me.id,online:true,free:40*1024**3,total:100*1024**3};
const folder={id:'019a0000-0000-7000-8000-000000000003',space_id:space.id,parent_id:null,name:'Документы',directory:true,state:'ready',size:0,mime:'application/octet-stream',updated_at:'2026-01-01T12:00:00Z',favorite:false};
const file={...folder,id:'019a0000-0000-7000-8000-000000000004',name:'Заметка.txt',directory:false,size:6,mime:'text/plain'};
const formatExamples=[['Клип.mp4','video'],['Запись.mp3','audio'],['Фото.png','image'],['Отчёт.pdf','pdf'],['Архив.zip','archive'],['Таблица.xlsx','spreadsheet'],['Неизвестный.bin','file']].map(([name,kind],i)=>({...file,id:`019a0000-0000-7000-8000-${(40+i).toString(16).padStart(12,'0')}`,name,mime:'application/octet-stream',kind}));
try{for(const width of [1440,390,320]){
 let fileParent:string|null=null,moveRequests=0,rejectMove=false;
 const uploads=new Map<string,{id:string;name:string;size:number;ready?:boolean}>();let uploadIndex=16;
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async dialog=>{errors.push('Unexpected system dialog: '+dialog.type());await dialog.dismiss();});await context.route('**/socket.io/**',r=>r.abort());
 await context.route('**/api/**',async route=>{const url=new URL(route.request().url()),p=url.pathname;
 if(p==='/api/storage/uploads'&&route.request().method()==='POST'){
  const metadata=route.request().headers()['upload-metadata'];const encoded=metadata.split(',').find(part=>part.trim().startsWith('nodeId '))!.trim().slice(7);const id=Buffer.from(encoded,'base64').toString();
  await route.fulfill({status:201,headers:{'Tus-Resumable':'1.0.0','Location':`/api/storage/uploads/${id}`}});return;
 }
 if(p===`/api/storage/${file.id}`&&route.request().method()==='PATCH'){
  moveRequests++;const body=route.request().postDataJSON();assert.ok(body.parentId===null||body.parentId===folder.id);
  if(rejectMove)return route.fulfill({status:409,json:{error:'Такое имя уже существует'}});
  fileParent=body.parentId;return route.fulfill({json:{ok:true}});
 }
 if(p.startsWith('/api/storage/uploads/')&&route.request().method()==='PATCH'){await route.fulfill({status:204,headers:{'Tus-Resumable':'1.0.0','Upload-Offset':route.request().headers()['content-length']??String(uploads.get(p.split('/').pop()!)?.size??3)}});return;}
 const uploaded=uploads.get(p.split('/').pop()!);
 if(uploaded&&p===`/api/storage/${uploaded.id}`){await route.fulfill({json:route.request().method()==='DELETE'?{ok:true}:{...file,...uploaded,state:uploaded.ready?'ready':'processing'}});return;}
 if(p==='/api/storage'&&route.request().method()==='POST'){
  const body=route.request().postDataJSON();assert.equal(body.spaceId,space.id);
  if(!body.directory){const id=`019a0000-0000-7000-8000-${(uploadIndex++).toString(16).padStart(12,'0')}`;const item={id,name:body.name,size:body.size};uploads.set(id,item);await route.fulfill({json:{...file,...item,state:'uploading'}});return;}
  assert.equal(body.directory,true);
  if(body.name==='Документы')await route.fulfill({status:409,json:{error:'Такое имя уже существует'}});else await route.fulfill({json:{...folder,id:'019a0000-0000-7000-8000-000000000005',name:body.name}});return;
 }
 const value=p==='/api/v1/me'?me:p==='/api/v1/users'?[me]:p==='/api/push'?{configured:false,enabled:true,showPreview:false,publicKey:null,mutedChatIds:[]}:p==='/api/storage/spaces'?[space]:p==='/api/storage'?{nodes:url.searchParams.has('parentId')?(fileParent===folder.id?[{...file,parent_id:fileParent}]:[]):[folder,...(fileParent===null?[file]:[]),...formatExamples,...Array.from(uploads.values()).filter(item=>item.ready).map(item=>({...file,...item,state:'ready'}))],breadcrumbs:url.searchParams.has('parentId')?[{id:folder.id,name:folder.name}]:[],canWrite:true}:p===`/api/storage/${file.id}`?file:[];
 if(p===`/api/storage/content/${file.id}`)await route.fulfill({body:'abcdef'});else await route.fulfill({json:value});});
 await page.goto(`${base}/storage`);await expect(page.getByRole('button',{name:'Добавить хранилище',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Загрузить',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Новая папка',exact:true})).toBeEnabled();
 if(width<=780)await page.getByRole('button',{name:'Открыть меню хранилища'}).click();
 await expect(page.locator('.ss-storage-sub')).toHaveText('Свободно 40 ГБ из 100 ГБ');await expect(page.getByRole('meter',{name:'Заполненность хранилища Домашнее'})).toHaveAttribute('aria-valuenow','60');
 await expect(page.getByRole('button',{name:'Права доступа',exact:true})).toHaveCount(0);
 const typography=await page.locator('.ss-file-name').first().evaluate(el=>({size:getComputedStyle(el).fontSize,weight:getComputedStyle(el).fontWeight}));assert.equal(typography.size,width<=780?'12px':'13px');assert.equal(typography.weight,'650');
 await page.screenshot({path:`/tmp/storage-capacity-${width}.png`});
 if(width<=780)await page.getByRole('button',{name:'Закрыть меню',exact:true}).click();
 for(const example of formatExamples)await expect(page.getByRole('button',{name:example.name,exact:true}).locator('.ss-file-icon')).toHaveAttribute('data-file-kind',example.kind);
 const shapes=await Promise.all(['Клип.mp4','Запись.mp3','Заметка.txt'].map(name=>page.getByRole('button',{name,exact:true}).locator('svg').evaluate(svg=>svg.innerHTML)));assert.equal(new Set(shapes).size,3,'Video, audio and text use different Lucide glyphs');
 await page.screenshot({path:`/tmp/storage-file-types-${width}.png`});
 // Whole-workspace desktop drops highlight without moving the layout; use the existing upload dialog.
 const desktopFiles=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(['one'],'drop-one.txt',{type:'text/plain'}));data.items.add(new File(['two'],'drop-two.txt',{type:'text/plain'}));return data;});
 const mainDrop=page.locator('.ss-main');await mainDrop.dispatchEvent('dragenter',{dataTransfer:desktopFiles});await expect(mainDrop).toHaveClass(/ss-upload-dragging/);
 await page.locator('.ss-heading').dispatchEvent('dragenter',{dataTransfer:desktopFiles});await page.locator('.ss-heading').dispatchEvent('dragleave',{dataTransfer:desktopFiles});await expect(mainDrop).toHaveClass(/ss-upload-dragging/);
 await page.screenshot({path:`/tmp/storage-desktop-drop-${width}.png`});
 await page.locator('.ss-heading h1').dispatchEvent('drop',{dataTransfer:desktopFiles});await expect(mainDrop).not.toHaveClass(/ss-upload-dragging/);
 const droppedDialog=page.getByRole('dialog',{name:'Загрузить',exact:true});await expect(droppedDialog).toContainText('2 файлов');await droppedDialog.getByRole('button',{name:'Отмена',exact:true}).click();
 await desktopFiles.dispose();
 // Real browser drag-and-drop moves a file into a folder and back through its breadcrumb.
 const dragFile=page.getByRole('button',{name:'Заметка.txt',exact:true}),dragFolder=page.getByRole('button',{name:'Документы',exact:true});
 await expect(dragFile).toHaveAttribute('draggable','true');await dragFile.dragTo(dragFolder);await expect(dragFile).toHaveCount(0);assert.equal(moveRequests,1);
 await dragFolder.click();await expect(dragFile).toBeVisible();
 const rootCrumb=page.getByRole('navigation',{name:'Путь к папке',exact:true}).getByRole('button',{name:'Домашнее',exact:true});
 await dragFile.dragTo(rootCrumb);await expect(dragFile).toHaveCount(0);assert.equal(moveRequests,2);await rootCrumb.click();await expect(dragFile).toBeVisible();
 // Self-drops are ignored; server failures leave the file in place and display the reason.
 const internal=await page.evaluateHandle(()=>new DataTransfer());await dragFolder.dispatchEvent('dragstart',{dataTransfer:internal});
 const folderRow=dragFolder.locator('..');await folderRow.dispatchEvent('dragover',{dataTransfer:internal});await expect(folderRow).not.toHaveClass(/ss-drop-target/);await folderRow.dispatchEvent('drop',{dataTransfer:internal});await dragFolder.dispatchEvent('dragend',{dataTransfer:internal});assert.equal(moveRequests,2);await internal.dispose();
 rejectMove=true;await dragFile.dragTo(dragFolder);await expect(page.getByRole('alert')).toContainText('Такое имя уже существует');await expect(dragFile).toBeVisible();assert.equal(moveRequests,3);rejectMove=false;await page.getByRole('button',{name:'Закрыть ошибку',exact:true}).click();

 await expect(page.getByRole('button',{name:'Документы',exact:true})).toBeVisible();
 for(const label of ['Переименовать','В корзину']){
  await page.getByRole('button',{name:'Действия: Документы',exact:true}).click();
  await page.getByRole('menuitem',{name:label,exact:true}).click();
  const actionDialog=page.getByRole('dialog',{name:label,exact:true});await expect(actionDialog).toBeVisible();
  if(label==='Переименовать'){await expect(actionDialog.getByLabel('Новое название')).toHaveValue('Документы');await expect(actionDialog.getByLabel('Новое название')).toBeFocused();}
  await actionDialog.getByRole('button',{name:'Отмена',exact:true}).click();await expect(actionDialog).toHaveCount(0);
 }
 await page.getByRole('button',{name:'Новая папка',exact:true}).click();
 const create=page.getByRole('dialog',{name:'Новая папка',exact:true}),name=create.getByLabel('Название папки');
 await expect(create).toBeVisible();await expect(name).toBeFocused();await expect(create.getByRole('button',{name:'Создать',exact:true})).toBeDisabled();
 await name.fill('Документы');await name.press('Enter');await expect(create.getByRole('alert')).toHaveText('Такое имя уже существует');await expect(name).toHaveValue('Документы');
 await page.screenshot({path:`/tmp/storage-folder-dialog-${width}.png`});
 await name.fill('Новая тестовая папка');await name.press('Enter');await expect(create).toHaveCount(0);
 await page.getByRole('button',{name:'Загрузить',exact:true}).click();
 const chooser=page.getByRole('dialog',{name:'Загрузить',exact:true});await expect(chooser.getByText('Перетащите файлы или папку сюда')).toBeVisible();
 await expect(chooser.getByRole('button',{name:'Выбрать папку'})).toBeVisible();
 await page.screenshot({path:`/tmp/storage-upload-dialog-${width}.png`});
 const selected=page.waitForEvent('filechooser');await chooser.getByRole('button',{name:'Выбрать файлы'}).click();
 await(await selected).setFiles([{name:'first.txt',mimeType:'text/plain',buffer:Buffer.from('one')},{name:'second.txt',mimeType:'text/plain',buffer:Buffer.from('two')}]);
 await expect(chooser.getByRole('button',{name:'Начать загрузку'})).toBeVisible();await expect(chooser).toContainText('2 файлов');await chooser.getByRole('button',{name:'Отмена',exact:true}).click();await expect(chooser).toHaveCount(0);
 await page.getByRole('button',{name:'Загрузить',exact:true}).click();await expect(chooser).toBeVisible();await page.keyboard.press('Escape');await expect(chooser).toHaveCount(0);

 await page.getByRole('button',{name:'Загрузить',exact:true}).click();const incoming=page.waitForEvent('filechooser');await chooser.getByRole('button',{name:'Выбрать файлы'}).click();
 await(await incoming).setFiles([1,2,3].map(i=>({name:`Длинное название документа для загрузки ${i}.txt`,mimeType:'text/plain',buffer:Buffer.from('sample file')})));
 await chooser.getByRole('button',{name:'Начать загрузку'}).click();
 const activity=page.getByRole('region',{name:'Уведомления хранилища'});await expect(activity).toContainText('Обработка: 3');await expect(activity.getByRole('progressbar',{name:'Общий прогресс загрузки',exact:true})).toHaveAttribute('value','100');
 const panel=activity.locator('details');await expect(panel).not.toHaveAttribute('open','');await panel.locator('summary').click();await expect(activity.locator('.ss-transfer-row')).toHaveCount(3);
 const headerBox=await page.locator('.ss-heading').boundingBox(),filesBox=await page.getByRole('region',{name:'Файлы',exact:true}).boundingBox();assert.ok(headerBox&&filesBox&&headerBox.y+headerBox.height<=filesBox.y,'Transfer panel is above files');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Activity panel does not overflow');await page.screenshot({path:`/tmp/storage-activity-${width}.png`});
 await activity.getByRole('button',{name:'Отменить загрузку',exact:true}).first().click();await expect(activity.locator('.ss-transfer-row')).toHaveCount(2);await panel.locator('summary').click();
 const waiting=Array.from(uploads.values()).slice(1);for(const item of waiting)await expect(page.getByRole('button',{name:item.name,exact:true})).toHaveCount(0);
 waiting[0].ready=true;await expect(page.getByRole('button',{name:waiting[0].name,exact:true})).toBeVisible();await expect(page.getByRole('button',{name:waiting[1].name,exact:true})).toHaveCount(0);
 await page.getByRole('searchbox',{name:'Поиск файлов'}).fill('Заметка');await expect(page.getByRole('button',{name:'Документы',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Заметка.txt',exact:true}).click();await expect(page.getByRole('dialog',{name:'Заметка.txt'})).toBeVisible();await expect(page.locator('.ss-preview pre')).toHaveText('abcdef');await page.getByRole('button',{name:'Закрыть просмотр'}).click();
 await page.getByRole('searchbox',{name:'Поиск файлов'}).fill('');await page.getByRole('button',{name:'Документы',exact:true}).click();await expect(page.getByRole('navigation',{name:'Путь к папке'})).toContainText('Документы');
 if(width<=780){
  const nav=page.getByRole('navigation',{name:'Навигация',exact:true});await expect(nav).toBeVisible();await expect(nav.getByRole('button',{name:'Хранилище',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('button',{name:'Назад к чатам',exact:true})).toHaveCount(0);
  const main=await page.locator('.ss-main').boundingBox(),menu=await nav.boundingBox();assert.ok(main&&menu&&main.y+main.height<=menu.y+1,'Files do not overlap navigation');
 }
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow');
 await page.screenshot({path:`/tmp/storage-files-${width}.png`});assert.deepEqual(errors,[]);if(width<=780){await page.getByRole('navigation',{name:'Навигация',exact:true}).getByRole('button',{name:'Чаты',exact:true}).click();await expect(page).toHaveURL(base+'/');}const shared={...space,name:'Общее',owner_id:null,personal_folder_label:'Пользователи'};
 let friendlyLabels=false;
 let grants:{id:string;group_name:string;access:string;node_id:string|null;node_name?:string}[]=[];
 await context.route('**/api/v1/admin/groups',r=>r.fulfill({json:[{id:me.id,name:'Редакторы'}]}));
 await context.route('**/api/storage**',async route=>{
  const request=route.request(),url=new URL(request.url()),pathname=url.pathname;
  if(pathname===`/api/storage/spaces/${shared.id}`&&request.method()==='PATCH'){const body=request.postDataJSON();assert.equal(body.personalFolderLabel,'Участники');shared.personal_folder_label=body.personalFolderLabel;return route.fulfill({json:{ok:true}});}
  if(pathname==='/api/storage/spaces')return route.fulfill({json:[shared,{...space,id:file.id,name:'Личное'}]});
  if(pathname==='/api/storage/grants'&&request.method()==='POST'){
   const body=request.postDataJSON();assert.equal(body.spaceId,shared.id);assert.equal(body.nodeId,folder.id);assert.equal(body.access,'write');
   grants=[{id:'grant-test',group_name:'Редакторы',access:body.access,node_id:body.nodeId,node_name:folder.name}];return route.fulfill({json:grants[0]});
  }
  if(pathname==='/api/storage/grants/grant-test'&&request.method()==='DELETE'){grants=[];return route.fulfill({json:{ok:true}});}
  if(pathname==='/api/storage/grants')return route.fulfill({json:grants});
  if(pathname==='/api/storage')return route.fulfill({json:{nodes:url.searchParams.has('parentId')?[]:[friendlyLabels?{...folder,display_name:'Иван Петров'}:folder],breadcrumbs:url.searchParams.has('parentId')?[{id:folder.id,name:folder.name}]:[],nextOffset:null}});
  return route.fallback();
 });
 await page.goto(base+'/admin/storage');await expect(page.getByRole('heading',{name:'Настройки хранилищ',exact:true})).toBeVisible();
 const adminPanel=page.locator('.storage-admin');await expect(adminPanel.getByLabel('Хранилище',{exact:true}).locator('option')).toHaveCount(1);
 await adminPanel.getByLabel('Название папки пользователей',{exact:true}).fill('Участники');await adminPanel.getByRole('button',{name:'Сохранить название',exact:true}).click();await expect(adminPanel).toContainText('Название сохранено');
 await adminPanel.getByRole('button',{name:folder.name,exact:true}).click();await adminPanel.getByLabel('Доступ',{exact:true}).selectOption('write');
 await adminPanel.getByRole('button',{name:'Добавить доступ к этой папке',exact:true}).click();
 await expect(adminPanel.locator('.storage-admin-grants')).toContainText('Редакторы');await expect(adminPanel.locator('.storage-admin-grants')).toContainText('Папка: Документы');
 await page.screenshot({path:`/tmp/storage-admin-${width}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Storage permissions do not overflow');
 await adminPanel.getByRole('button',{name:/Убрать доступ:/}).click();await expect(adminPanel).toContainText('Дополнительные права групп не назначены');
 friendlyLabels=true;await page.goto(base+'/storage');await expect(page.getByRole('button',{name:'Иван Петров',exact:true})).toBeVisible();await page.getByRole('searchbox',{name:'Поиск файлов',exact:true}).fill('Иван');await expect(page.getByRole('button',{name:'Иван Петров',exact:true})).toBeVisible();
 assert.deepEqual(errors,[]);await context.close();
}console.log('PASS storage responsive UI, navigation, filtering and text preview at 1440/390/320px');}finally{await browser.close();await server.close();}
