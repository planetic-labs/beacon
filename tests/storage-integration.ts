import {access,transaction} from "../apps/api/src/modules/storage/service";
// Run only against a disposable database, never the development deployment.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp,rm,mkdir,readFile,statfs,writeFile,symlink,readdir,rename,lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { v7 } from 'uuid';
import { makeSignature } from 'better-auth/crypto';
import { pool } from '../apps/api/src/db';
import { auth } from '../apps/api/src/modules/auth/config';
import { createApp } from '../apps/api/src/http/server';
import { storageJobs,stopStorageJobs } from '../apps/api/src/modules/storage/jobs';
if(process.env.APP_ENV!=='test')throw new Error('Disposable test environment required');
process.env.STORAGE_JOBS_SCHEMA=`storage_check_${randomBytes(8).toString('hex')}`;
const root=await mkdtemp(path.join(tmpdir(),'beacon-storage-integration-'));process.env.STORAGE_ROOT=root;
await mkdir(path.join(root,'personal'));await mkdir(path.join(root,'shared'));
const teamConfigId=`team-${randomBytes(6).toString("hex")}`;
const definitions:import("../apps/api/src/modules/storage/config").StorageDefinition[]=[{id:'home',name:'Домашнее',path:path.join(root,'personal'),mode:'local',personal_parent:'users'},{id:teamConfigId,name:'Общее',path:path.join(root,'shared'),mode:'local'}];
process.env.STORAGES_JSON=JSON.stringify(definitions);
const app=await createApp({serveWeb:false});
await storageJobs();await app.listen({host:'127.0.0.1',port:0});
const address=app.server.address();if(!address||typeof address==='string')throw new Error('No port');
const base=`http://127.0.0.1:${address.port}`,origin=process.env.APP_URL!;
const ctx=await auth.$context;
async function account(role:string){const id=v7();await pool.query('insert into "user"(id,name,email,email_verified,role) values($1,$2,$3,true,$4)',[id,'Тестовый пользователь',`storage-${id}@example.com`,role]);const session=await ctx.internalAdapter.createSession(id);if(!session)throw new Error('No session');const cookie=`${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${await makeSignature(session.token,process.env.BETTER_AUTH_SECRET!)}`)}`;return{id,cookie};}
const admin=await account('admin'),owner=await account('admin'),stranger=await account('admin'),regular=await account('user');
async function request(user:{cookie:string},url:string,method='GET',body?:unknown,headers:Record<string,string>={}){return fetch(`${base}/api/storage${url}`,{method,headers:{cookie:user.cookie,origin,...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});}
async function api(user:{cookie:string},url:string,method='GET',body?:unknown){const r=await request(user,url,method,body);const data=await r.json();assert.equal(r.ok,true,`${method} ${url}: ${r.status} ${JSON.stringify(data)}`);return data;}
async function ready(id:string,user=owner){for(let i=0;i<80;i++){const n=await api(user,`/${id}`);if(n.state==='ready')return n;await new Promise(r=>setTimeout(r,100));}throw new Error('Job timed out');}
try{
 await mkdir(path.join(root,'personal','users',`user-${owner.id}`),{recursive:true});
 await writeFile(path.join(root,'personal','users',`user-${owner.id}`,'Прежний файл.txt'),'old personal content');
 for(const path of ['/spaces','?spaceId='+v7(),'/content/'+v7()])assert.equal((await request(regular,path)).status,403);
 const deniedTus=await fetch(`${base}/api/storage/uploads`,{method:'POST',headers:{cookie:regular.cookie,origin,'tus-resumable':'1.0.0','upload-length':'0'}});assert.equal(deniedTus.status,403);
 const [home]=await api(owner,'/spaces');assert.equal(home.owner_id,owner.id);const disk=await statfs(path.join(root,'personal'),{bigint:true});assert.equal(home.online,true);assert.equal(home.total,Number(disk.blocks*disk.bsize));assert.ok(home.free>=0&&home.free<=home.total);
 const previous=(await api(owner,`?spaceId=${home.id}`)).nodes.find((n:{name:string})=>n.name==='Прежний файл.txt');assert.ok(previous);assert.equal(await(await request(owner,`/content/${previous.id}`)).text(),'old personal content');
 assert.equal((await request(stranger,`?spaceId=${home.id}`)).status,404);assert.equal((await request(admin,`?spaceId=${home.id}`)).status,404);
 const folder=await api(owner,'','POST',{spaceId:home.id,name:'Документы',directory:true});
 assert.equal((await request(owner,'','POST',{spaceId:home.id,name:'../secret',directory:true})).status,400);
 assert.equal((await request(owner,'','POST',{spaceId:home.id,name:'Документы',directory:true})).status,409);
 const file=await api(owner,'','POST',{spaceId:home.id,parentId:folder.id,name:'Текст.txt',size:6});
 assert.ok(!(await api(owner,`?spaceId=${home.id}&parentId=${folder.id}`)).nodes.some((n:{id:string})=>n.id===file.id),'Reserved uploads are not directory entries');
 const metadata=`nodeId ${Buffer.from(file.id).toString('base64')}`;
 const created=await fetch(`${base}/api/storage/uploads`,{method:'POST',headers:{cookie:owner.cookie,origin,'tus-resumable':'1.0.0','upload-length':'6','upload-metadata':metadata}});
 assert.equal(created.status,201,await created.text());const location=created.headers.get('location')!;assert.ok(location.endsWith(file.id));
 async function chunk(offset:number,text:string,user=owner){return fetch(new URL(location,base),{method:'PATCH',headers:{cookie:user.cookie,origin,'tus-resumable':'1.0.0','upload-offset':String(offset),'content-type':'application/offset+octet-stream'},body:text});}
 assert.equal((await chunk(0,'abc',stranger)).status,404);
 assert.equal((await chunk(0,'abc')).status,204);
 await assert.rejects(lstat(path.join(root,'personal','users',`user-${owner.id}`,'Документы','Текст.txt')),{code:'ENOENT'});
 assert.equal(await readFile(path.join(root,'personal','users',`user-${owner.id}`,'.beacon-uploads',file.id),'utf8'),'abc');
 await assert.rejects(lstat(path.join(root,'.uploads')),{code:'ENOENT'});
 const stagedInode=(await lstat(path.join(root,'personal','users',`user-${owner.id}`,'.beacon-uploads',file.id))).ino;
 assert.ok(!(await api(owner,`?spaceId=${home.id}&parentId=${folder.id}`)).nodes.some((n:{id:string})=>n.id===file.id),'Interrupted uploads remain hidden');
 const duplicate=await fetch(`${base}/api/storage/uploads`,{method:'POST',headers:{cookie:owner.cookie,origin,'tus-resumable':'1.0.0','upload-length':'6','upload-metadata':metadata}});assert.equal(duplicate.status,409);
 assert.equal((await chunk(0,'bad')).status,409);
 const head=await fetch(new URL(location,base),{method:'HEAD',headers:{cookie:owner.cookie,'tus-resumable':'1.0.0'}});assert.equal(head.headers.get('upload-offset'),'3');
 process.env.STORAGES_JSON=JSON.stringify(definitions.map(d=>d.id==='home'?{...d,mode:'sshfs'}:d));assert.equal((await chunk(3,'def')).status,503);await assert.rejects(lstat(path.join(root,'.uploads')),{code:'ENOENT'});process.env.STORAGES_JSON=JSON.stringify(definitions);
 assert.equal((await chunk(3,'def')).status,204);await ready(file.id);assert.equal(await readFile(path.join(root,'personal','users',`user-${owner.id}`,'Документы','Текст.txt'),'utf8'),'abcdef');
 assert.ok((await api(owner,`?spaceId=${home.id}&parentId=${folder.id}`)).nodes.some((n:{id:string})=>n.id===file.id),'Completed uploads appear in the directory');
 assert.equal((await lstat(path.join(root,'personal','users',`user-${owner.id}`,'Документы','Текст.txt'))).ino,stagedInode,'Publication reuses the Tus file inode instead of copying');
 const content=await request(owner,`/content/${file.id}`,'GET',undefined,{range:'bytes=2-4'});assert.equal(content.status,206);assert.equal(await content.text(),'cde');
 assert.equal((await request(stranger,`/content/${file.id}`)).status,404);
 assert.equal((await request(owner,`/${folder.id}`,'PATCH',{parentId:folder.id})).status,400);
 const receiver=await api(owner,'','POST',{spaceId:home.id,name:'Приёмник',directory:true});
 await api(owner,`/${file.id}`,'PATCH',{parentId:receiver.id});
 assert.equal(await readFile(path.join(root,'personal','users',`user-${owner.id}`,'Приёмник','Текст.txt'),'utf8'),'abcdef');
 await assert.rejects(lstat(path.join(root,'personal','users',`user-${owner.id}`,'Документы','Текст.txt')),{code:'ENOENT'});
 await api(owner,`/${file.id}`,'PATCH',{parentId:folder.id});
 assert.equal(await readFile(path.join(root,'personal','users',`user-${owner.id}`,'Документы','Текст.txt'),'utf8'),'abcdef');
 await api(owner,`/${file.id}`,'PATCH',{name:'Переименован.txt'});
 await api(owner,`/${file.id}/favorite`,'POST',{favorite:true});
 assert.equal((await api(owner,`?spaceId=${home.id}&view=favorites`)).nodes.length,1);
 assert.equal((await api(owner,`?spaceId=${home.id}&view=recent`)).nodes.length,2);
 const copy=await api(owner,`/${file.id}/copy`,'POST',{parentId:null,name:'Копия.txt'});await ready(copy.id);assert.equal(await(await request(owner,`/content/${copy.id}`)).text(),'abcdef');
 await api(owner,`/${file.id}/hash`,'POST');for(let i=0;i<80;i++){const n=await api(owner,`/${file.id}`);if(n.sha256){assert.equal(n.sha256.length,64);break;}await new Promise(r=>setTimeout(r,100));if(i===79)throw new Error('Hash timed out');}
 const folderCopy=await api(owner,`/${folder.id}/copy`,'POST',{parentId:null,name:'Копия папки'});const copiedChildren=(await api(owner,`?spaceId=${home.id}&parentId=${folderCopy.id}`)).nodes;assert.equal(copiedChildren.length,1);await ready(copiedChildren[0].id);
 await api(owner,`/${folder.id}`,'DELETE');assert.equal((await request(owner,`/content/${file.id}`)).status,404);
 assert.equal((await api(owner,`?spaceId=${home.id}&view=favorites`)).nodes.length,0);
 await api(owner,`/${folder.id}/restore`,'POST');assert.equal((await request(owner,`/content/${file.id}`)).status,200);
 await api(owner,`/${folder.id}`,'DELETE');await api(owner,`/${folder.id}/purge`,'POST');
 for(let i=0;i<80;i++){if((await request(owner,`/${folder.id}`)).status===404)break;await new Promise(r=>setTimeout(r,100));if(i===79)throw new Error('Purge timed out');}
 const shared=(await api(admin,'/spaces')).find((s:{owner_id:string|null})=>s.owner_id===null);assert.ok(shared);assert.equal((await request(admin,'/spaces','POST',{name:'Нельзя'})).status,405);
 const sharedFile=await api(admin,'','POST',{spaceId:shared.id,name:'Shared.txt',size:4});
 const started=await fetch(`${base}/api/storage/uploads`,{method:'POST',headers:{cookie:admin.cookie,origin,'tus-resumable':'1.0.0','upload-length':'4','upload-metadata':`nodeId ${Buffer.from(sharedFile.id).toString('base64')}`}});assert.equal(started.status,201);
 const sharedChunk=await fetch(new URL(started.headers.get('location')!,base),{method:'PATCH',headers:{cookie:admin.cookie,origin,'tus-resumable':'1.0.0','upload-offset':'0','content-type':'application/offset+octet-stream'},body:'te'});assert.equal(sharedChunk.status,204);
 assert.equal(await readFile(path.join(root,'shared','.beacon-uploads',sharedFile.id),'utf8'),'te');
 const sharedFinish=await fetch(new URL(started.headers.get('location')!,base),{method:'PATCH',headers:{cookie:admin.cookie,origin,'tus-resumable':'1.0.0','upload-offset':'2','content-type':'application/offset+octet-stream'},body:'am'});assert.equal(sharedFinish.status,204);
 await ready(sharedFile.id,admin);assert.equal(await readFile(path.join(root,'shared','Shared.txt'),'utf8'),'team');assert.ok(!JSON.stringify(await api(admin,'/spaces')).includes(root));
// Real filesystem discovery, external changes, physical rename/move and safe publication.
 const sharedRoot=path.join(root,'shared');
 await mkdir(path.join(sharedRoot,'С диска','Вложенная'),{recursive:true});
 await writeFile(path.join(sharedRoot,'С диска','Вложенная','Оригинал.txt'),'external bytes');
 await writeFile(path.join(sharedRoot,'.hidden'),'hidden');
 await symlink('/etc/passwd',path.join(sharedRoot,'escape.txt'));
 const externalList=await api(admin,`?spaceId=${shared.id}`);
 assert.ok(!externalList.nodes.some((n:{name:string})=>n.name==='escape.txt'||n.name.startsWith('.')));
 const external=externalList.nodes.find((n:{name:string})=>n.name==='С диска');assert.ok(external);
 assert.ok(!JSON.stringify(externalList).includes('filesystem_path'));
 const externalCopy=await api(admin,`/${external.id}/copy`,'POST',{parentId:null,name:'Копия с диска'});
 const copiedDir=(await api(admin,`?spaceId=${shared.id}&parentId=${externalCopy.id}`)).nodes[0];
 const copiedFile=(await api(admin,`?spaceId=${shared.id}&parentId=${copiedDir.id}`)).nodes[0];await ready(copiedFile.id,admin);
 assert.equal(await readFile(path.join(sharedRoot,'Копия с диска','Вложенная','Оригинал.txt'),'utf8'),'external bytes');
 await api(admin,`/${external.id}`,'PATCH',{name:'Переименовано'});
 assert.equal(await readFile(path.join(sharedRoot,'Переименовано','Вложенная','Оригинал.txt'),'utf8'),'external bytes');
 const child=(await api(admin,`?spaceId=${shared.id}&parentId=${external.id}`)).nodes[0];
 let actualFile=(await api(admin,`?spaceId=${shared.id}&parentId=${child.id}`)).nodes[0];const originalId=actualFile.id;
 await writeFile(path.join(sharedRoot,'Переименовано','Вложенная','Оригинал.txt'),'changed external bytes');
 actualFile=(await api(admin,`?spaceId=${shared.id}&parentId=${child.id}`)).nodes[0];assert.equal(actualFile.id,originalId);assert.equal(actualFile.size,22);
 await rm(path.join(sharedRoot,'Переименовано','Вложенная','Оригинал.txt'));
 assert.equal((await api(admin,`?spaceId=${shared.id}&parentId=${child.id}`)).nodes.length,0);
 assert.equal((await request(admin,`/content/${originalId}`)).status,404);
 await writeFile(path.join(sharedRoot,'Переименовано','Вложенная','Оригинал.txt'),'returned');
 assert.equal((await api(admin,`?spaceId=${shared.id}&parentId=${child.id}`)).nodes[0].id,originalId);
 await api(admin,`/${external.id}`,'DELETE');
 await assert.rejects(lstat(path.join(sharedRoot,'Переименовано')),{code:'ENOENT'});
 await api(admin,`/${external.id}/restore`,'POST');
 assert.equal(await readFile(path.join(sharedRoot,'Переименовано','Вложенная','Оригинал.txt'),'utf8'),'returned');
 const cancelled=await api(admin,'','POST',{spaceId:shared.id,name:'Reserved.txt',size:3});
 await writeFile(path.join(sharedRoot,'Reserved.txt'),'must survive cancellation');
 await api(admin,`/${cancelled.id}`,'DELETE');
 for(let i=0;i<80;i++){if((await request(admin,`/${cancelled.id}`)).status===404)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await readFile(path.join(sharedRoot,'Reserved.txt'),'utf8'),'must survive cancellation');
await pool.query('update "user" set role=$2 where id=$1',[owner.id,'user']);
const group=v7();await pool.query('insert into membership_group(id,name,code) values($1,$2,$3)',[group,'Тестовая группа',`storage-${group}`]);await pool.query('insert into group_member(group_id,user_id) values($1,$2)',[group,owner.id]);
 assert.equal((await request(owner,`?spaceId=${shared.id}`)).status,403);
 await api(admin,'/grants','POST',{spaceId:shared.id,groupId:group,access:'read'});
 await transaction(c=>access(c,shared.id,null,{id:owner.id,role:'user'}));
 await assert.rejects(transaction(c=>access(c,shared.id,null,{id:owner.id,role:'user'},true)));
 assert.equal((await request(owner,'/spaces')).status,403);
 assert.equal((await request(owner,'','POST',{spaceId:shared.id,name:'Нельзя',directory:true})).status,403);
 const grants=await api(admin,`/grants?spaceId=${shared.id}`);for(const g of grants)await api(admin,`/grants/${g.id}`,'DELETE');
 const corridor=await api(admin,'','POST',{spaceId:shared.id,name:'Путь',directory:true});
 const allowed=await api(admin,'','POST',{spaceId:shared.id,parentId:corridor.id,name:'Разрешено',directory:true});
 const hidden=await api(admin,'','POST',{spaceId:shared.id,parentId:corridor.id,name:'Скрыто',directory:true});
 await api(admin,'/grants','POST',{spaceId:shared.id,nodeId:allowed.id,groupId:group,access:'read'});
 await transaction(c=>access(c,shared.id,allowed.id,{id:owner.id,role:'user'}));
 await assert.rejects(transaction(c=>access(c,shared.id,hidden.id,{id:owner.id,role:'user'})));
 assert.equal((await request(regular,'/spaces','POST',{name:'Нельзя'})).status,403);
 await pool.query('update "user" set role=$2 where id=$1',[owner.id,'admin']);
 const sameId=shared.id;
 process.env.STORAGES_JSON=JSON.stringify(definitions.map(d=>d.id===teamConfigId?{...d,name:'Переименовано'}:d));
 const renamed=(await api(admin,'/spaces')).find((s:{owner_id:string|null})=>s.owner_id===null);assert.equal(renamed.id,sameId);assert.equal(renamed.name,'Переименовано');
 process.env.STORAGES_JSON=JSON.stringify(definitions.map(d=>d.id===teamConfigId?{...d,mode:'sshfs'}:d));assert.equal((await request(admin,`?spaceId=${shared.id}`)).status,503);const unavailable=(await api(admin,'/spaces')).find((s:{id:string})=>s.id===shared.id);assert.equal(unavailable.online,false);assert.equal(unavailable.free,null);assert.equal(unavailable.total,null);
 process.env.STORAGES_JSON=JSON.stringify(definitions.filter(d=>d.id!==teamConfigId));
 assert.equal((await request(owner,`?spaceId=${shared.id}`)).status,404);assert.ok(!(await api(admin,'/spaces')).some((s:{id:string})=>s.id===sameId));
 process.env.STORAGES_JSON=JSON.stringify(definitions);
 assert.equal((await api(admin,'/spaces')).find((s:{owner_id:string|null})=>s.owner_id===null).id,sameId);
 // A 200 GiB declaration must not allocate local spool space or the declared file size.
 const large=await api(admin,'','POST',{spaceId:shared.id,name:'Большой файл.bin',size:200*1024**3});
 const largeStart=await fetch(`${base}/api/storage/uploads`,{method:'POST',headers:{cookie:admin.cookie,origin,'tus-resumable':'1.0.0','upload-length':String(200*1024**3),'upload-metadata':`nodeId ${Buffer.from(large.id).toString('base64')}`}});assert.equal(largeStart.status,201);
 const largeStage=path.join(root,'shared','.beacon-uploads',large.id);assert.equal((await lstat(largeStage)).size,0);
 await assert.rejects(lstat(path.join(root,'.uploads')),{code:'ENOENT'});
 assert.equal((await request(admin,'','POST',{spaceId:shared.id,name:'Слишком большой.bin',size:1024**4+1})).status,400);
 await api(admin,`/${large.id}`,'DELETE');
 for(let i=0;i<100;i++){try{await lstat(largeStage);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')break;throw e;}if(i===99)throw Error('Staging cleanup timed out');await new Promise(r=>setTimeout(r,100));}
 // More simultaneous Tus writes than the pool size must not require a second SQL
 // connection after acquiring an upload lock. All partial data stays on its target disk.
 const concurrent=await Promise.all(Array.from({length:12},(_,i)=>api(admin,'','POST',{spaceId:shared.id,name:`Concurrent-${i}.bin`,size:2})));
 await Promise.all(concurrent.map(async n=>{
   const start=await fetch(`${base}/api/storage/uploads`,{method:'POST',signal:AbortSignal.timeout(20000),headers:{cookie:admin.cookie,origin,'tus-resumable':'1.0.0','upload-length':'2','upload-metadata':`nodeId ${Buffer.from(n.id).toString('base64')}`}});assert.equal(start.status,201);
   const part=await fetch(new URL(start.headers.get('location')!,base),{method:'PATCH',signal:AbortSignal.timeout(20000),headers:{cookie:admin.cookie,origin,'tus-resumable':'1.0.0','upload-offset':'0','content-type':'application/offset+octet-stream'},body:'x'});assert.equal(part.status,204);
   assert.equal(await readFile(path.join(root,'shared','.beacon-uploads',n.id),'utf8'),'x');
 }));
 // Friendly labels use Beacon UUIDs, while directory names stay untouched.
 const labelDefinition={id:`labels-${randomBytes(6).toString('hex')}`,name:'Каталоги пользователей',path:path.join(root,'personal'),mode:'local'};
 process.env.STORAGES_JSON=JSON.stringify([...definitions,labelDefinition]);
 const labelSpace=(await api(admin,'/spaces')).find((s:{name:string})=>s.name===labelDefinition.name);assert.ok(labelSpace);
 let userRoot=(await api(admin,`?spaceId=${labelSpace.id}`)).nodes.find((n:{name:string})=>n.name==='users');assert.ok(userRoot);assert.equal(userRoot.display_name,'Пользователи');
 await api(admin,`/spaces/${labelSpace.id}`,'PATCH',{personalFolderLabel:'Участники'});
 assert.equal((await api(admin,'/spaces')).find((s:{id:string})=>s.id===labelSpace.id).personal_folder_label,'Участники');
 userRoot=(await api(admin,`?spaceId=${labelSpace.id}`)).nodes.find((n:{id:string})=>n.id===userRoot.id);assert.equal(userRoot.name,'users');assert.equal(userRoot.display_name,'Участники');
 await pool.query('update "user" set first_name=$2,last_name=$3 where id=$1',[owner.id,'Иван','Проверочный']);
 let named=(await api(admin,`?spaceId=${labelSpace.id}&parentId=${userRoot.id}`)).nodes.find((n:{name:string})=>n.name===`user-${owner.id}`);assert.ok(named);assert.equal(named.display_name,'Иван Проверочный');
 const namedListing=await api(admin,`?spaceId=${labelSpace.id}&parentId=${named.id}`);assert.equal(namedListing.breadcrumbs[0].name,'Участники');assert.equal(namedListing.breadcrumbs[1].name,'Иван Проверочный');
 assert.equal((await api(admin,`/${named.id}`)).display_name,'Иван Проверочный');
 await pool.query('update "user" set first_name=$2 where id=$1',[owner.id,'Пётр']);
 named=(await api(admin,`?spaceId=${labelSpace.id}&parentId=${userRoot.id}`)).nodes.find((n:{name:string})=>n.name===`user-${owner.id}`);assert.equal(named.display_name,'Пётр Проверочный');
 await mkdir(path.join(root,'personal','users','user-123'));
 const unknown=(await api(admin,`?spaceId=${labelSpace.id}&parentId=${userRoot.id}`)).nodes.find((n:{name:string})=>n.name==='user-123');assert.equal(unknown.display_name,undefined);
 assert.equal((await request(admin,`/spaces/${labelSpace.id}`,'PATCH',{personalFolderLabel:' '})).status,400);
 assert.equal((await request(admin,`/spaces/${home.id}`,'PATCH',{personalFolderLabel:'Invalid'})).status,404);
 assert.equal((await request(regular,`/spaces/${labelSpace.id}`,'PATCH',{personalFolderLabel:'Invalid'})).status,403);
 assert.ok((await lstat(path.join(root,'personal','users',`user-${owner.id}`))).isDirectory());
 process.env.STORAGES_JSON=JSON.stringify(definitions);
 const forged=await fetch(`${base}/api/storage`,{method:'POST',headers:{cookie:owner.cookie,origin:'https://attacker.example.com','content-type':'application/json'},body:JSON.stringify({spaceId:home.id,name:'Нельзя',directory:true})});assert.equal(forged.status,403);
 console.log('PASS filesystem discovery, UUID personal folders, external changes, physical moves, atomic publication, cancellation safety; storage: isolation, ACL, resumable upload, conflicting offsets, ranges, rename, copy, SHA-256, favorites, recent, trash, restoration, purge, CSRF');
}finally{await app.close();await stopStorageJobs();await pool.end();await rm(root,{recursive:true,force:true});}
