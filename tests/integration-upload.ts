// Disposable database, filesystem and synthetic accounts only.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {v7} from 'uuid';
import {makeSignature} from 'better-auth/crypto';
import {pool} from '../apps/api/src/db';
import {auth} from '../apps/api/src/modules/auth/config';
import {createApp} from '../apps/api/src/http/server';
import {stopStorageJobs} from '../apps/api/src/modules/storage/jobs';
if(process.env.APP_ENV!=='test')throw Error('Disposable environment required');
const root=await mkdtemp(path.join(tmpdir(),'beacon-integration-upload-'));
process.env.STORAGES_JSON=JSON.stringify([{id:'upload-test',name:'Test',path:root,mode:'local'}]);
process.env.STORAGE_JOBS_SCHEMA=`upload_test_${randomBytes(6).toString('hex')}`;
const app=await createApp({serveWeb:false});await app.listen({host:'127.0.0.1',port:0});
const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`,api='/api/integrations/v1/uploads',ctx=await auth.$context;
const user=v7(),viewer=v7(),space=v7(),folder=v7(),token=randomBytes(32).toString('base64url'),otherToken=randomBytes(32).toString('base64url');
async function cookie(id:string,role:string){await pool.query('insert into "user"(id,name,email,email_verified,role) values($1,$2,$3,true,$4)',[id,'Test',`${id}@example.com`,role]);const session=await ctx.internalAdapter.createSession(id);assert.ok(session);return`${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${await makeSignature(session.token,process.env.BETTER_AUTH_SECRET!)}`)}`;}
const adminCookie=await cookie(user,'admin'),viewerCookie=await cookie(viewer,'user');
const definition=(id:string,key:string)=>({id,tokenSha256:createHash('sha256').update(key).digest('hex'),userId:user,spaceId:space,parentId:folder,capabilities:['files:create']});
process.env.UPLOAD_INTEGRATIONS_JSON=JSON.stringify([definition('zoom',token),definition('other',otherToken)]);
const send=(suffix:string,method='GET',body?:unknown,key=token)=>fetch(base+api+suffix,{method,headers:{authorization:`Bearer ${key}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
try{
 await mkdir(path.join(root,'incoming'));
 await pool.query('insert into storage_space(id,name,provider) values($1,$2,$3)',[space,'Test','config:upload-test']);
 await pool.query('insert into storage_node(id,space_id,name,directory,created_by,filesystem_path) values($1,$2,$3,true,$4,$3)',[folder,space,'incoming',user]);
 for(const route of ['/api/docs','/api/docs/','/api/docs/json','/api/docs/yaml','/api/docs/static/swagger-ui.css','/api/docs/static/swagger-initializer.js']){const r=await fetch(base+route,{redirect:'manual'});assert.equal(r.status,401,route);assert.match(r.headers.get('cache-control')! ,/no-store/);assert.ok(!(await r.text()).includes('openapi'));}
 for(const cookie of [adminCookie,viewerCookie]){const r=await fetch(base+'/api/docs/json',{headers:{cookie}});assert.equal(r.status,200);const doc=await r.json();assert.equal(doc.openapi,'3.0.3');assert.equal(doc.paths[api].post.requestBody.content['application/json'].schema.additionalProperties,false);assert.ok(!JSON.stringify(doc).includes(token));for(const p of Object.values(doc.paths) as any[])assert.equal(p.delete,undefined);}
 assert.equal((await fetch(base+'/api/docs/',{headers:{cookie:adminCookie}})).status,200);
 await pool.query('update "user" set banned=true where id=$1',[viewer]);assert.equal((await fetch(base+'/api/docs/json',{headers:{cookie:viewerCookie}})).status,401);
 assert.equal((await fetch(base+api,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'text.txt',size:6})})).status,401);
 assert.equal((await send('','POST',{name:'text.txt',size:6},'bad-key')).status,401);
 assert.equal((await send('','POST',{name:'../escape',size:6})).status,400);
 assert.equal((await send('','POST',{name:'text.txt',size:6,spaceId:v7()})).status,400);
 const created=await send('','POST',{name:'text.txt',size:6});assert.equal(created.status,201);const file=await created.json();assert.ok(file.id);assert.equal(file.metadata.nodeId,file.id);
 const chapters=await send('','POST',{name:'text.chapters.json',size:2});assert.equal(chapters.status,201);const chapterFile=await chapters.json();
 assert.equal((await send(`/${file.id}`,'GET',undefined,otherToken)).status,404);
 for(const method of ['PUT','PATCH','DELETE'])assert.equal((await send(`/${file.id}`,method,{name:'overwrite'})).status,405);
 const start=await fetch(base+file.uploadEndpoint,{method:'POST',headers:{authorization:`Bearer ${token}`,'Tus-Resumable':'1.0.0','Upload-Length':'6','Upload-Metadata':`nodeId ${Buffer.from(file.id).toString('base64')}`}});assert.equal(start.status,201,await start.text());
 const location=new URL(start.headers.get('location')!,base);
 const chunk=(offset:number,bytes:string,key=token)=>fetch(location,{method:'PATCH',headers:{authorization:`Bearer ${key}`,'Tus-Resumable':'1.0.0','Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream'},body:bytes});
 assert.equal((await chunk(0,'abc',otherToken)).status,404);assert.equal((await chunk(0,'abc')).status,204);
 const head=await fetch(location,{method:'HEAD',headers:{authorization:`Bearer ${token}`,'Tus-Resumable':'1.0.0'}});assert.equal(head.status,200);assert.equal(head.headers.get('upload-offset'),'3');
 assert.equal((await chunk(0,'abc')).status,409);assert.equal((await chunk(3,'def')).status,204);
 let ready=false;for(let i=0;i<100;i++){const response=await send(`/${file.id}`);assert.equal(response.status,200);if((await response.json()).state==='ready'){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready);assert.equal(await readFile(path.join(root,'incoming','text.txt'),'utf8'),'abcdef');
 assert.equal((await chunk(6,'x')).status,409);assert.equal((await send('','POST',{name:'text.txt',size:7})).status,409);
 const chapterStart=await fetch(base+chapterFile.uploadEndpoint,{method:'POST',headers:{authorization:`Bearer ${token}`,'Tus-Resumable':'1.0.0','Upload-Length':'2','Upload-Metadata':`nodeId ${Buffer.from(chapterFile.id).toString('base64')}`}});assert.equal(chapterStart.status,201);
 const chapterPatch=await fetch(new URL(chapterStart.headers.get('location')!,base),{method:'PATCH',headers:{authorization:`Bearer ${token}`,'Tus-Resumable':'1.0.0','Upload-Offset':'0','Content-Type':'application/offset+octet-stream'},body:'[]'});assert.equal(chapterPatch.status,204);
 let chapterReady=false;for(let i=0;i<100;i++){if((await(await send(`/${chapterFile.id}`)).json()).state==='ready'){chapterReady=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(chapterReady);assert.equal(await readFile(path.join(root,'incoming','text.chapters.json'),'utf8'),'[]');
 assert.equal((await fetch(base+`/api/storage/${file.id}`,{method:'DELETE',headers:{authorization:`Bearer ${token}`,origin:process.env.APP_URL!}})).status,401);
 process.env.UPLOAD_INTEGRATIONS_JSON=JSON.stringify([{...definition('zoom',token),capabilities:[]}]);assert.equal((await send(`/${file.id}`)).status,403);
 console.log('PASS authenticated API docs and contracts, create-only scoped keys, timecode file upload, tus resume/offsets, ownership, immutable completion, duplicate names and revocation');
}finally{await app.close();await stopStorageJobs();await pool.end();await rm(root,{recursive:true,force:true});}
