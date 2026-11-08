import type {FastifyInstance,FastifyReply} from 'fastify';
import {fromNodeHeaders} from 'better-auth/node';
import {z} from 'zod';
import {actor,adminOnly,checkOrigin,HttpError} from '../../lib/http';
import {transaction,access,ancestors,node,audit,type User,type Node} from '../../modules/storage/service';
import {readyFile,loadMaterial,saveFileCard,scheduleFolderScan,fileMime,folderPublished,ensureCard} from '../../modules/materials/service';
import {safeInlineTypes} from '../../modules/storage/validation';
import {byteRange} from '../../modules/media/range';
const uuid=z.uuid();
export async function materialsRoutes(app:FastifyInstance){
 for(const url of ['/api/materials','/api/materials/*'])app.route({method:['GET','HEAD','POST','PUT','DELETE'],url,handler:run});
 for(const resource of ['card','playlist'])app.route({method:['GET','PUT','POST','DELETE'],url:`/api/storage/:fileId/${resource}`,handler:storageRun});
 for(const resource of ['content','cover'])app.route({method:['GET','HEAD'],url:`/api/storage/:fileId/card/${resource}`,handler:storageRun});
 for(const url of ['/api/storage/playlists','/api/storage/playlists/:playlistId'])app.route({method:['GET','POST','PUT','DELETE'],url,handler:virtualRun});
}
async function virtualRun(request:import('fastify').FastifyRequest,reply:FastifyReply){
 try{
  const headers=fromNodeHeaders(request.headers),u=await actor(headers);adminOnly(u);checkOrigin(new Request(new URL(request.url,process.env.APP_URL),{method:request.method,headers}));
  const id=(request.params as {playlistId?:string}).playlistId;
  const result=await transaction(async c=>{
   if(request.method==='GET'){
    const rows=(await c.query('select id,name,enabled from material_playlist order by name,id')).rows,out=[];
    for(const p of rows){const nodes:Node[]=(await c.query('select n.* from storage_node n join material_playlist_item i on i.material_id=n.id where i.playlist_id=$1 order by i.ordinal,n.id',[p.id])).rows;let allowed=true;for(const n of nodes)try{await access(c,n.space_id,n.id,u,false,true);}catch(e){if(e instanceof HttpError){allowed=false;break;}throw e;}if(allowed)out.push({...p,kind:'virtual',materialIds:nodes.map(n=>n.id),files:nodes.map(n=>({id:n.id,name:n.name}))});}
    return out;
   }
   if(id){uuid.parse(id);const current=(await c.query('select id from material_playlist where id=$1 for update',[id])).rows[0];if(!current)throw new HttpError(404,'Плейлист не найден');const files:Node[]=(await c.query('select n.* from storage_node n join material_playlist_item i on i.material_id=n.id where i.playlist_id=$1',[id])).rows;for(const n of files)await access(c,n.space_id,n.id,u,true,true);}
   if(request.method==='DELETE'&&id){await c.query('delete from material_playlist where id=$1',[id]);return{ok:true};}
   if(!['POST','PUT'].includes(request.method)||request.method==='PUT'&&!id)throw new HttpError(405,'Метод недоступен');
   const raw=Buffer.isBuffer(request.body)?JSON.parse(request.body.toString()):request.body;
   const value=z.object({name:z.string().trim().min(1).max(240),enabled:z.boolean().default(false),materialIds:z.array(uuid).max(1000).refine(ids=>new Set(ids).size===ids.length)}).strict().parse(raw);
   for(const fileId of value.materialIds){const n=await node(c,fileId);await access(c,n.space_id,fileId,u,true,true);await ensureCard(c,n);}
   const row=id?(await c.query('update material_playlist set name=$2,enabled=$3 where id=$1 returning id',[id,value.name,value.enabled])).rows[0]:(await c.query('insert into material_playlist(name,enabled) values($1,$2) returning id',[value.name,value.enabled])).rows[0];
   if(!row)throw new HttpError(404,'Плейлист не найден');await c.query('delete from material_playlist_item where playlist_id=$1',[row.id]);for(const[index,fileId]of value.materialIds.entries())await c.query('insert into material_playlist_item(playlist_id,material_id,ordinal) values($1,$2,$3)',[row.id,fileId,index]);return{id:row.id};
  });return reply.send(result);
 }catch(e){return failure(e,reply);}
}
async function publicCard(c:import('pg').PoolClient,id:string,u:User){const n=(await c.query('select * from storage_node where id=$1',[id])).rows[0];if(!n||n.directory||!await folderPublished(c,n))throw new HttpError(404,'Материал недоступен или плейлист не опубликован');return loadMaterial(c,id,u);}
async function sendFile(reply:FastifyReply,headers:Headers,id:string,sourceId:string,revision:number,download:boolean,cover=false,published=false){
 const file=await transaction(async c=>{
  const row=(await c.query('select revision,fingerprint from material where id=$1',[sourceId])).rows[0];
  if(!row||row.revision!==revision)throw new HttpError(409,'Файл изменился');
  if(published){const source=(await c.query('select * from storage_node where id=$1',[sourceId])).rows[0];if(!source||!await folderPublished(c,source))throw new HttpError(404,'Материал недоступен');}
  const file=await readyFile(c,id);
  if(!cover&&file.fingerprint!==row.fingerprint){await file.handle.close();throw new HttpError(409,'Файл изменился. Обновите страницу');}
  return file;
 },false);
 let sent=false;try{
  let range;try{range=byteRange(headers.get('range'),file.size);}catch{reply.header('Content-Range',`bytes */${file.size}`);throw new HttpError(416,'Неверный диапазон');}
  const mime=fileMime(file.n);if(cover&&!['image/png','image/jpeg','image/webp'].includes(mime))throw new HttpError(404,'Обложка недоступна');
  const inline=!download&&(safeInlineTypes.has(mime)||mime==='text/plain');
  reply.type(inline?mime:'application/octet-stream').header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").header('Accept-Ranges','bytes');
  const name=encodeURIComponent(file.n.name).replace(/['()*]/g,ch=>'%'+ch.charCodeAt(0).toString(16));
  reply.header('Content-Disposition',`${inline?'inline':'attachment'}; filename="file"; filename*=UTF-8''${name}`).header('Content-Length',String(range?range.end-range.start+1:file.size));
  if(range)reply.code(206).header('Content-Range',`bytes ${range.start}-${range.end}/${file.size}`);
  if(headers.get('x-beacon-head')==='1')return reply.send();
  const stream=file.handle.createReadStream({start:range?.start,end:range?.end,autoClose:true});sent=true;return reply.send(stream);
 }finally{if(!sent)await file.handle.close();}
}
function failure(error:unknown,reply:FastifyReply){const status=error instanceof HttpError?error.status:error instanceof z.ZodError||error instanceof SyntaxError?400:500;return reply.code(status).header('Cache-Control','no-store').send({error:status===500?'Не удалось выполнить запрос':error instanceof HttpError?error.message:'Проверьте данные карточки'});}
async function storageRun(request:import('fastify').FastifyRequest,reply:FastifyReply){
 try{
  const headers=fromNodeHeaders(request.headers),u=await actor(headers),url=new URL(request.url,process.env.APP_URL);
  if(request.method!=='HEAD')checkOrigin(new Request(url,{method:request.method,headers}));
  if(request.method==='HEAD')headers.set('x-beacon-head','1');else headers.delete('x-beacon-head');
  const parts=url.pathname.split('/'),id=uuid.parse(parts[3]),resource=parts[4],action=parts[5];
  if(!['GET','HEAD','PUT'].includes(request.method))throw new HttpError(405,'Управляйте файлом через хранилище');
  const body=Buffer.isBuffer(request.body)?JSON.parse(request.body.toString()||'{}'):request.body??{};
  const n=await transaction(async c=>{const n=await node(c,id);await access(c,n.space_id,id,u,request.method==='PUT');return n;},false);
  if(resource==='playlist'){
   if(!n.directory)throw new HttpError(400,'Плейлистом может стать только папка');
   const result=await transaction(async c=>{
    // Recheck access while changing the publication setting.
    await access(c,n.space_id,id,u,request.method==='PUT');
    if(request.method==='PUT'){const value=z.object({enabled:z.boolean()}).strict().parse(body);await c.query('insert into storage_material_folder(folder_id,enabled) values($1,$2) on conflict(folder_id) do update set enabled=$2,updated_at=now()',[id,value.enabled]);await audit(c,u,value.enabled?'playlist-enable':'playlist-disable',n);}
    return{folderId:id,enabled:(await c.query('select enabled from storage_material_folder where folder_id=$1',[id])).rows[0]?.enabled??false};
   });
   if(result.enabled)scheduleFolderScan(n);return reply.send(result);
  }
  if(request.method==='PUT'){await transaction(c=>saveFileCard(c,u,id,body));return reply.send({id});}
  const card=await transaction(c=>loadMaterial(c,id,u),false);
  if(!action){let canWrite=true;try{await transaction(c=>access(c,n.space_id,id,u,true),false);}catch(e){if(e instanceof HttpError&&e.status===403)canWrite=false;else throw e;}return reply.send({...card,canWrite});}
  if(action==='cover'){if(!card.coverId)throw new HttpError(404,'Обложка не найдена');return sendFile(reply,headers,card.coverId,id,card.revision,false,true);}
  if(!card.available||card.checking)throw new HttpError(503,'Файл проверяется или недоступен');
  return sendFile(reply,headers,id,id,card.revision,url.searchParams.has('download'));
 }catch(e){return failure(e,reply);}
}
async function run(request:import('fastify').FastifyRequest,reply:FastifyReply){
 try{
  const headers=fromNodeHeaders(request.headers),u=await actor(headers),url=new URL(request.url,process.env.APP_URL);
  if(request.method!=='HEAD')checkOrigin(new Request(url,{method:request.method,headers}));
  if(request.method==='HEAD')headers.set('x-beacon-head','1');else headers.delete('x-beacon-head');
  const parts=url.pathname.slice('/api/materials'.length).split('/').filter(Boolean),method=request.method;
  if(method==='GET'&&!parts.length){
   const result=await transaction(async c=>{
    const folders:Node[]=(await c.query('select n.* from storage_node n join storage_material_folder f on f.folder_id=n.id where f.enabled and n.directory and n.state=\'ready\' and n.deleted_at is null order by n.name,n.id')).rows;
    const cards=new Map<string,Awaited<ReturnType<typeof loadMaterial>>>(),playlists=[];let checking=0;
    async function cardFor(id:string){if(!cards.has(id)){const card=await loadMaterial(c,id,u,false);if(card.checking)checking++;cards.set(id,card);}return cards.get(id)!;}
    for(const folder of folders){
     if((await ancestors(c,folder.id)).some(n=>n.deleted_at||n.state!=='ready'))continue;
     if(scheduleFolderScan(folder))checking++;
     const rows=(await c.query("select id from storage_node where parent_id=$1 and not directory and state='ready' and deleted_at is null order by name collate \"C\",id",[folder.id])).rows;
     const ids:string[]=[];
     for(const row of rows){const card=await cardFor(row.id);if(card.published&&card.available&&!card.needsReview)ids.push(card.id);}
     playlists.push({id:folder.id,name:folder.name,kind:'folder',materialIds:ids});
    }
    const virtuals=(await c.query('select id,name from material_playlist where enabled order by name,id')).rows;
    for(const p of virtuals){const rows=(await c.query('select i.material_id as id from material_playlist_item i join storage_node n on n.id=i.material_id where i.playlist_id=$1 and n.state=\'ready\' and n.deleted_at is null order by i.ordinal,n.id',[p.id])).rows,ids=[];for(const row of rows){const card=await cardFor(row.id);if(card.published&&card.available&&!card.needsReview)ids.push(card.id);}playlists.push({...p,kind:'virtual',materialIds:ids});}
    const materials=[...cards.values()].filter(card=>card.published&&card.available&&!card.needsReview);
    materials.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
    return{materials,playlists,checking};
   },false);return reply.send(result);
  }
  if(!parts.length||parts[0]==='playlists'||parts[0]==='files')throw new HttpError(405,'Карточками и плейлистами управляют в хранилище');
  const id=uuid.parse(parts[0]);
  if(!['GET','HEAD'].includes(method)&&!(method==='POST'&&parts[1]==='progress'))throw new HttpError(405,'Карточками управляют в хранилище');
  const card=await transaction(c=>publicCard(c,id,u),false);
  if(!card.published||card.needsReview||!card.available&&!card.checking)throw new HttpError(404,'Материал недоступен или плейлист не опубликован');
  if(parts.length===1&&method==='GET')return reply.send(card);
  if(parts[1]==='progress'&&method==='POST'){
   if(!['video','audio'].includes(card.kind)||!card.available||card.checking)throw new HttpError(409,'Запись пока недоступна');
   const body=Buffer.isBuffer(request.body)?JSON.parse(request.body.toString()):request.body;
   const value=z.object({position:z.number().finite().min(0).max(card.duration),revision:z.number().int().positive()}).strict().parse(body);
   await transaction(async c=>{
    const n=await node(c,id),current=await loadMaterial(c,id,u);
    if(!current.published||current.needsReview||!current.available||current.checking||current.revision!==value.revision)throw new HttpError(409,'Файл изменился');
    await c.query('insert into material_progress(user_id,material_id,revision,position) values($1,$2,$3,$4) on conflict(user_id,material_id) do update set revision=$3,position=$4,updated_at=now()',[u.id,n.id,value.revision,Math.floor(value.position)]);
   });return reply.send({ok:true});
  }
  if(!['GET','HEAD'].includes(method)||!['content','video','cover'].includes(parts[1]))throw new HttpError(404,'Не найдено');
  if(parts[1]==='cover'){if(!card.coverId)throw new HttpError(404,'Обложка не найдена');return sendFile(reply,headers,card.coverId,id,card.revision,false,true,true);}
  if(card.checking)throw new HttpError(503,'Проверяем запись. Попробуйте через несколько секунд');
  // Publication is checked again immediately before opening the stream.
  const latest=await transaction(c=>publicCard(c,id,u),false);if(!latest.published||latest.needsReview||!latest.available)throw new HttpError(404,'Материал недоступен');
  return sendFile(reply,headers,id,id,card.revision,url.searchParams.has('download'),false,true);
 }catch(e){return failure(e,reply);}
}
