// Run only against a disposable database and synthetic filesystem.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rename,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {v7} from 'uuid';import {makeSignature} from 'better-auth/crypto';
import {pool} from '../apps/api/src/db';import {auth} from '../apps/api/src/modules/auth/config';import {createApp} from '../apps/api/src/http/server';
if(process.env.APP_ENV!=='test')throw Error('Disposable environment required');
const root=await mkdtemp(path.join(tmpdir(),'beacon-folder-materials-'));process.env.STORAGES_JSON=JSON.stringify([{id:'materials-test',name:'Test',path:root,mode:'local'}]);
const exec=promisify(execFile),app=await createApp({serveWeb:false}),ctx=await auth.$context;
const space=v7(),admin=v7(),viewer=v7(),writer=v7(),group=v7(),folder=v7(),nested=v7(),video=v7(),audio=v7(),document=v7(),image=v7(),hidden=v7(),rootDoc=v7();
async function account(id:string,role:string){await pool.query('insert into "user"(id,name,email,email_verified,role) values($1,$2,$3,true,$4)',[id,'Test',id+'@example.com',role]);const s=await ctx.internalAdapter.createSession(id);assert.ok(s);return ctx.authCookies.sessionToken.name+'='+encodeURIComponent(s.token+'.'+await makeSignature(s.token,process.env.BETTER_AUTH_SECRET!));}
const adminCookie=await account(admin,'admin'),viewerCookie=await account(viewer,'user'),writerCookie=await account(writer,'user');
const request=(cookie:string,url:string,method='GET',body?:unknown,headers:Record<string,string>={})=>app.inject({method:method as any,url,headers:{cookie,origin:process.env.APP_URL!,...(body?{'content-type':'application/json'}:{}),...headers},payload:body?JSON.stringify(body):undefined});
const card=(id:string)=>'/api/storage/'+id+'/card',playlist=(id:string)=>'/api/storage/'+id+'/playlist',detail=(id:string)=>'/api/materials/'+id;
async function settled(id:string){for(let i=0;i<150;i++){const r=await request(adminCookie,card(id));assert.equal(r.statusCode,200,r.body);if(!r.json().checking)return r.json();await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Verification timed out');}
async function catalog(){return(await request(viewerCookie,'/api/materials')).json();}
async function stableCatalog(){for(let i=0;i<150;i++){const value=await catalog();if(!value.checking)return value;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Catalogue did not settle');}
async function generate(name:string,color:string){await exec('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','color=c='+color+':s=320x240:r=12','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',path.join(root,'folder',name)],{timeout:20000});}
const virtuals:string[]=[];
try{
 await mkdir(path.join(root,'folder','nested'),{recursive:true});await generate('01-video.mp4','blue');
 await exec('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','anullsrc=r=44100:cl=mono','-t','4','-c:a','libmp3lame',path.join(root,'folder','02-audio.mp3')],{timeout:20000});
 await writeFile(path.join(root,'folder','03-document.txt'),'document bytes');await writeFile(path.join(root,'folder','04-image.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1cAAAAASUVORK5CYII=','base64'));await writeFile(path.join(root,'folder','nested','private.txt'),'nested');await writeFile(path.join(root,'root.txt'),'root document');await writeFile(path.join(root,'folder','05-external.txt'),'discovered without a database row');
 await pool.query('insert into storage_space(id,name,provider) values($1,$2,$3)',[space,'Test','config:materials-test']);
 for(const [id,parent,name,relative]of [[folder,null,'folder','folder'],[nested,folder,'nested','folder/nested']])await pool.query('insert into storage_node(id,space_id,parent_id,name,directory,created_by,filesystem_path) values($1,$2,$3,$4,true,$5,$6)',[id,space,parent,name,admin,relative]);
 for(const[id,parent,name,mime,relative]of [[video,folder,'01-video.mp4','video/mp4','folder/01-video.mp4'],[audio,folder,'02-audio.mp3','audio/mpeg','folder/02-audio.mp3'],[document,folder,'03-document.txt','text/plain','folder/03-document.txt'],[image,folder,'04-image.png','image/png','folder/04-image.png'],[hidden,nested,'private.txt','text/plain','folder/nested/private.txt'],[rootDoc,null,'root.txt','text/plain','root.txt']])await pool.query('insert into storage_node(id,space_id,parent_id,name,created_by,filesystem_path,mime,size) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,space,parent,name,admin,relative,mime,(await stat(path.join(root,relative!))).size]);
 // A legacy video/card/progress is retained; its old published flag is not a grant.
 const fs=await stat(path.join(root,'folder','01-video.mp4'),{bigint:true}),fp=[fs.dev,fs.ino,fs.size,fs.mtimeNs,fs.ctimeNs].join(':'),digest=createHash('sha256').update(await readFile(path.join(root,'folder','01-video.mp4'))).digest('hex');
 await pool.query("insert into material(id,title,description,published,duration,source_hash,fingerprint,created_by) values($1,'Existing title','Existing description',true,4,$2,$3,$4)",[video,digest,fp,admin]);
 await pool.query("insert into material_chapter(material_id,ordinal,seconds,title) values($1,0,2,'Existing chapter')",[video]);await pool.query('insert into material_progress(user_id,material_id,revision,position) values($1,$2,1,2)',[viewer,video]);
 await pool.query("insert into material_attachment(material_id,ordinal,label,file_id) values($1,0,'Old attachment',$2)",[video,hidden]);
 assert.equal((await catalog()).materials.length,0);assert.equal((await request(viewerCookie,detail(video))).statusCode,404);
 assert.equal((await request(viewerCookie,card(video))).statusCode,403);assert.equal((await request(viewerCookie,playlist(folder),'PUT',{enabled:true})).statusCode,403);
 const initial=(await request(adminCookie,card(video))).json();assert.equal(initial.title,'Existing title');assert.equal(initial.chapters[0].title,'Existing chapter');assert.ok(!('attachments'in initial));
 await pool.query('insert into membership_group(id,name,code) values($1,$2,$3)',[group,'Writers','writers-'+group]);await pool.query('insert into group_member(group_id,user_id) values($1,$2)',[group,writer]);await pool.query("insert into storage_grant(space_id,node_id,group_id,access) values($1,$2,$3,'write')",[space,folder,group]);
 assert.equal((await request(writerCookie,playlist(folder),'PUT',{enabled:true})).statusCode,200);
 let value=await stableCatalog();assert.equal(value.materials.length,5);const discovered=value.materials.find((m:any)=>m.fileName==='05-external.txt');assert.ok(discovered);assert.deepEqual(value.playlists[0].materialIds,[video,audio,document,image,discovered.id]);assert.equal(value.playlists[0].kind,'folder');assert.equal(value.playlists[0].id,folder);assert.ok(!value.materials.some((m:any)=>m.id===hidden));
 for(const[id,kind]of [[video,'video'],[audio,'audio'],[document,'document'],[image,'image']])assert.equal(value.materials.find((m:any)=>m.id===id).kind,kind);
 const shared=(await request(viewerCookie,detail(video))).json();assert.equal(shared.position,2);assert.equal(shared.chapters[0].seconds,2);
 const range=await request(viewerCookie,detail(video)+'/content','GET',undefined,{range:'bytes=0-15'});assert.equal(range.statusCode,206);assert.equal(range.rawPayload.length,16);
 assert.equal((await request('',detail(video)+'/content')).statusCode,401);assert.equal((await request(viewerCookie,detail(video)+'/attachments/0')).statusCode,404);
 assert.equal((await request(viewerCookie,detail(document)+'/content')).body,'document bytes');assert.match(String((await request(viewerCookie,detail(document)+'/content?download=1')).headers['content-disposition']),/^attachment/);
 assert.equal((await request(viewerCookie,detail(audio)+'/content','HEAD')).statusCode,200);
 const input={title:'Edited in Storage',description:'One card per file',coverId:image,chapters:[{seconds:1,title:'New chapter'}]};
 assert.equal((await request(writerCookie,card(video),'PUT',input)).statusCode,200);assert.equal((await request(viewerCookie,detail(video))).json().title,input.title);
 assert.equal((await request(writerCookie,card(video),'PUT',{...input,attachments:[]})).statusCode,400);
 assert.equal((await request(writerCookie,card(document),'PUT',{...input,chapters:[{seconds:1,title:'Invalid'}]})).statusCode,400);
 assert.equal((await request(adminCookie,detail(video),'PUT',input)).statusCode,405);assert.equal((await request(adminCookie,detail(video),'DELETE')).statusCode,405);
 const v1=(await request(adminCookie,'/api/storage/playlists','POST',{name:'First',enabled:true,materialIds:[rootDoc,video,audio]})).json().id;const v2=(await request(adminCookie,'/api/storage/playlists','POST',{name:'Second',enabled:true,materialIds:[audio,video]})).json().id;assert.ok(v1&&v2);virtuals.push(v1,v2);
 value=await stableCatalog();assert.equal(value.materials.length,6);assert.deepEqual(value.playlists.find((p:any)=>p.id===v1).materialIds,[rootDoc,video,audio]);assert.deepEqual(value.playlists.find((p:any)=>p.id===v2).materialIds,[audio,video]);assert.equal(value.playlists.filter((p:any)=>p.materialIds.includes(video)).length,3);
 assert.equal((await request(viewerCookie,detail(rootDoc))).statusCode,200);
 assert.equal((await request(viewerCookie,detail(video)+'/progress','POST',{position:3,revision:shared.revision})).statusCode,200);
 assert.equal((await request(viewerCookie,detail(video))).json().position,3);
 const lock=await pool.connect();try{await lock.query('begin');await lock.query('select pg_advisory_xact_lock(917342)');const start=Date.now(),release=setTimeout(()=>void lock.query('rollback'),2000);try{assert.equal((await request(viewerCookie,'/api/materials')).statusCode,200);assert.ok(Date.now()-start<1500);}finally{clearTimeout(release);}}finally{await lock.query('rollback');lock.release();}
 // A newly registered file appears without creating a publication/card manually.
 const added=v7();await writeFile(path.join(root,'folder','05-new.txt'),'new');await pool.query("insert into storage_node(id,space_id,parent_id,name,created_by,filesystem_path,mime,size) values($1,$2,$3,'05-new.txt',$4,'folder/05-new.txt','text/plain',3)",[added,space,folder,admin]);assert.ok((await stableCatalog()).materials.some((m:any)=>m.id===added));
 await request(adminCookie,'/api/storage/'+video,'PATCH',{parentId:null});await settled(video);value=await stableCatalog();assert.ok(!value.playlists.find((p:any)=>p.id===folder).materialIds.includes(video));assert.ok(value.playlists.find((p:any)=>p.id===v1).materialIds.includes(video));assert.equal((await request(viewerCookie,detail(video))).json().position,3);
 await request(adminCookie,playlist(folder),'PUT',{enabled:false});value=await stableCatalog();assert.ok(!value.playlists.some((p:any)=>p.id===folder));assert.equal((await request(viewerCookie,detail(document))).statusCode,404);assert.equal((await request(adminCookie,card(document))).statusCode,200);
 await pool.query('update storage_node set deleted_at=now() where id=$1',[video]);assert.equal((await request(viewerCookie,detail(video))).statusCode,404);await pool.query('update storage_node set deleted_at=null where id=$1',[video]);assert.equal((await request(viewerCookie,detail(video))).json().position,3);
 await generate('01-video.mp4','red'); // Original path is now a new unrelated file; do not affect moved UUID.
 assert.equal((await request(viewerCookie,detail(video))).json().position,3);
 await exec('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=red:s=320x240:r=12','-t','4','-c:v','libx264','-pix_fmt','yuv420p',path.join(root,'01-video.mp4')],{timeout:20000});
 const changed=await settled(video);assert.equal(changed.needsReview,true);assert.equal(changed.position,0);assert.ok(changed.revision>shared.revision);assert.equal((await request(viewerCookie,detail(video))).statusCode,404);
 assert.equal((await request(writerCookie,card(video),'PUT',{...input,reviewed:true})).statusCode,403); // Moved outside the writer's grant.
 assert.equal((await request(adminCookie,card(video),'PUT',{...input,reviewed:true})).statusCode,200);
 assert.equal((await request(viewerCookie,detail(video)+'/progress','POST',{position:1,revision:shared.revision})).statusCode,409);
 for(const id of virtuals)assert.equal((await request(adminCookie,'/api/storage/playlists/'+id,'DELETE')).statusCode,200);
 assert.equal((await request(viewerCookie,detail(video))).statusCode,404);assert.equal((await request(adminCookie,card(video))).json().chapters[0].title,'New chapter');assert.ok((await readFile(path.join(root,'01-video.mp4'))).length);assert.equal((await pool.query('select count(*)::int as count from material_attachment where material_id=$1',[video])).rows[0].count,1);
 console.log('PASS file-owned cards, legacy data preservation, folder and virtual playlists, multi-kind views, scoped writers, shared chapters/progress, move/trash/replacement and non-destructive unpublication');
}finally{await app.close();await pool.end();await rm(root,{recursive:true,force:true});}
