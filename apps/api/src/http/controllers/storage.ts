import { displayLabels } from "../../modules/storage/labels";
import { activeProviders,configuredStorages,providerKey } from "../../modules/storage/config";
import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { Readable } from "node:stream";
import { z } from "zod";
import { actor, adminOnly, checkOrigin, HttpError } from "../../lib/http";
import { transaction, syncDirectory, syncTree, moveOnDisk, syncConfiguredSpaces, space, access, node, parent, personal, createNode, ancestors, descendants, publicNode, audit, type User, type Node } from "../../modules/storage/service";
import { enqueue } from "../../modules/storage/jobs";
import { storageForSpace,storageCapacity } from "../../modules/storage/provider";
import { nodeName, uuid, maxUploadSize, guessedMime, safeInlineTypes } from "../../modules/storage/validation";
import { byteRange } from "../../modules/media/range";
import { tusRoutes } from "./storage-upload";
const bodySchema=z.object({spaceId:uuid,parentId:uuid.nullable().default(null),name:nodeName,directory:z.boolean().default(false),size:z.number().int().min(0).max(maxUploadSize).default(0)});
export async function storageRoutes(app:FastifyInstance){
  await app.register(tusRoutes);
  app.route({method:['GET','POST','PATCH','DELETE'],url:'/api/storage',handler:run});
  app.route({method:['GET','POST','PATCH','DELETE'],url:'/api/storage/*',handler:run});
}
async function run(request:import('fastify').FastifyRequest,reply:import('fastify').FastifyReply){
  try{
    const headers=fromNodeHeaders(request.headers),u=await actor(headers);adminOnly(u);
    checkOrigin(new Request(new URL(request.url,process.env.APP_URL),{method:request.method,headers}));
    const url=new URL(request.url,process.env.APP_URL),parts=url.pathname.slice('/api/storage'.length).split('/').filter(Boolean);
    const data=request.body instanceof Buffer?JSON.parse(request.body.toString()||'{}'):request.body??{};
    if(parts[0]==='content'&&request.method==='GET'){
      const n=await transaction(async c=>{let n=await node(c,uuid.parse(parts[1]));await access(c,n.space_id,n.id,u);await syncDirectory(c,n.space_id,n.parent_id,u);n=await node(c,n.id);await access(c,n.space_id,n.id,u);if(n.directory||n.state!=='ready')throw new HttpError(409,'Файл ещё не готов');await c.query(`insert into storage_user_node(user_id,node_id,visited_at) values($1,$2,now()) on conflict(user_id,node_id) do update set visited_at=now()`,[u.id,n.id]);return n;});
      const size=Number(n.size);let range;
      try{range=byteRange(request.headers.range??null,size);}catch{return reply.code(416).header('Content-Range',`bytes */${size}`).send();}
      reply.type(n.mime).header('Accept-Ranges','bytes').header('Content-Security-Policy',"default-src 'none'; sandbox").header('X-Content-Type-Options','nosniff');
      const inline=!url.searchParams.has('download')&&safeInlineTypes.has(n.mime);
      reply.header('Content-Disposition',`${inline?'inline':'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(n.name).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16)}`)}`);
      if(range)reply.code(206).header('Content-Range',`bytes ${range.start}-${range.end}/${size}`);
      reply.header('Content-Length',String(range?range.end-range.start+1:size));
      const stream=await transaction(async c=>(await storageForSpace(c,n.space_id)).readStream(n.id,range?.start,range?.end));
      return reply.send(stream);
    }
    const result=await transaction(async c=>{
      if(parts[0]==='spaces'){
        if(request.method==='PATCH'&&parts.length===2){
          const s=await space(c,uuid.parse(parts[1]),u);
          if(s.owner_id)throw new HttpError(400,'Выберите общее хранилище');
          const {personalFolderLabel}=z.object({personalFolderLabel:z.string().trim().min(1).max(80).refine(value=>!/[\x00-\x1f\x7f]/.test(value))}).strict().parse(data);
          await c.query('update storage_space set personal_folder_label=$2 where id=$1',[s.id,personalFolderLabel]);return{ok:true};
        }
        if(request.method!=='GET')throw new HttpError(405,'Метод недоступен');
        await syncConfiguredSpaces(c);
        await personal(c,u);
        return(await c.query(`select s.* from storage_space s where (s.owner_id=$1 and s.provider=any($4::text[])) or (s.owner_id is null and s.provider=any($3::text[]) and ($2 or exists(select 1 from storage_grant g join group_member m on m.group_id=g.group_id where g.space_id=s.id and m.user_id=$1))) order by s.owner_id nulls last,s.name`,[u.id,u.role==='admin',activeProviders(),configuredStorages().filter(item=>item.personal_parent!==undefined).map(item=>providerKey(item.id))])).rows;
      }
      if(parts[0]==='grants'){
        adminOnly(u);
        if(request.method==='GET'){
          const spaceId=uuid.parse(url.searchParams.get('spaceId'));
          const {rows}=await c.query('select g.*,m.name as group_name,n.name as node_name,n.directory,n.filesystem_path from storage_grant g join membership_group m on m.id=g.group_id left join storage_node n on n.id=g.node_id where g.space_id=$1',[spaceId]);
          const labels=await displayLabels(c,spaceId,rows.map(g=>({directory:g.directory,name:g.node_name??'',filesystem_path:g.filesystem_path})));
          return rows.map(({directory,filesystem_path,...grant},index)=>({...grant,node_name:labels[index].display_name??grant.node_name}));
        }
        if(request.method==='DELETE'){await c.query('delete from storage_grant where id=$1',[uuid.parse(parts[1])]);return{ok:true};}
        const v=z.object({spaceId:uuid,nodeId:uuid.nullable().default(null),groupId:uuid,access:z.enum(['read','write'])}).parse(data);
        await access(c,v.spaceId,v.nodeId,u,true);if(v.nodeId&&!(await node(c,v.nodeId)).directory)throw new HttpError(400,'Выберите папку');
        return(await c.query('insert into storage_grant(space_id,node_id,group_id,access) values($1,$2,$3,$4) returning *',[v.spaceId,v.nodeId,v.groupId,v.access])).rows[0];
      }
      if(parts[0]==='audit'&&request.method==='GET'){adminOnly(u);return(await c.query('select * from storage_audit order by created_at desc limit 200')).rows;}
      if(parts.length===0&&request.method==='GET'){
        const spaceId=uuid.parse(url.searchParams.get('spaceId')),parentId=url.searchParams.get('parentId')?uuid.parse(url.searchParams.get('parentId')):null,view=url.searchParams.get('view')??'all';
        const offset=z.coerce.number().int().min(0).max(10000000).parse(url.searchParams.get('offset')??0);
        await space(c,spaceId,u);
        await storageForSpace(c,spaceId);
        const chain=await ancestors(c,parentId);let canWrite=false;
        try{await access(c,spaceId,parentId,u,true);canWrite=true;}catch(e){if(!(e instanceof HttpError))throw e;}
        // Users with a grant only on a descendant may traverse its ancestors.
        try{await access(c,spaceId,parentId,u);}catch(e){
          if(!(e instanceof HttpError)||e.status!==403||view!=='all')throw e;
          const allowed=(await c.query(`with recursive allowed as(select n.* from storage_node n join storage_grant g on g.node_id=n.id join group_member m on m.group_id=g.group_id where g.space_id=$1 and m.user_id=$2 union select n.* from storage_node n join allowed a on a.parent_id=n.id) select 1 from allowed where id=$3 or $3::uuid is null limit 1`,[spaceId,u.id,parentId])).rows;
          if(!allowed.length)throw e;
        }
        if(view==='all')await syncDirectory(c,spaceId,parentId,u);
        const {rows}=await c.query(`select n.*,coalesce(p.favorite,false) as favorite from storage_node n left join storage_user_node p on p.node_id=n.id and p.user_id=$2 where n.space_id=$1 and n.state not in ('purging','missing') and (n.directory or n.source_id is not null or n.state='ready' or $3='trash') and (case when $3='trash' then n.deleted_at is not null when $3='favorites' then p.favorite=true and n.deleted_at is null when $3='recent' then p.visited_at is not null and n.deleted_at is null else n.parent_id is not distinct from $4::uuid and n.deleted_at is null end) order by case when $3='recent' then p.visited_at end desc nulls last,n.directory desc,n.name limit 201 offset $5`,[spaceId,u.id,view,parentId,offset]);
        const {rows:[owner]}=await c.query('select owner_id from storage_space where id=$1',[spaceId]);
        const unrestricted=view==='all'&&(owner.owner_id===u.id||u.role==='admin');
        const visible=[];for(const n of rows.slice(0,200)){if(unrestricted){visible.push(n);continue;}try{await access(c,spaceId,n.id,u,false,view==='trash');visible.push(n);}catch(e){
          if(!(e instanceof HttpError))throw e;
          if(view==='all'&&n.directory&&!n.deleted_at){const allowed=await c.query(`with recursive tree as(select id from storage_node where id=$1 union all select n.id from storage_node n join tree t on n.parent_id=t.id) select 1 from storage_grant g join group_member m on m.group_id=g.group_id where g.node_id in(select id from tree) and m.user_id=$2 limit 1`,[n.id,u.id]);if(allowed.rows.length)visible.push(n);}
        }}
        return {nodes:(await displayLabels(c,spaceId,visible.slice(0,200))).map(publicNode),nextOffset:rows.length>200?offset+200:null,breadcrumbs:(await displayLabels(c,spaceId,chain.reverse())).map(n=>({id:n.id,name:n.display_name??n.name})),canWrite};
      }
      if(parts.length===0&&request.method==='POST'){
        const v=bodySchema.parse(data),n=await createNode(c,u,{...v,mime:guessedMime(v.name),state:v.directory?'ready':'uploading'});return publicNode(n);
      }
      const id=uuid.parse(parts[0]),n=await node(c,id),action=parts[1];
      await access(c,n.space_id,id,u,!(request.method==='GET'||action==='favorite'||action==='copy'),action==='restore'||action==='purge'||action==='retry');
      if(request.method==='GET'){await audit(c,u,'details',n);return publicNode((await displayLabels(c,n.space_id,[n]))[0]);}
      if(action==='favorite'&&request.method==='POST'){
        const {favorite}=z.object({favorite:z.boolean()}).parse(data);await c.query('insert into storage_user_node(user_id,node_id,favorite) values($1,$2,$3) on conflict(user_id,node_id) do update set favorite=excluded.favorite',[u.id,id,favorite]);return{ok:true};
      }
      if(action==='retry'&&request.method==='POST'){
        if(n.state!=='error')throw new HttpError(409,'Операция ещё выполняется');
        const state=n.deleted_at?'purging':n.source_id?'copying':'processing';
        await c.query('update storage_node set state=$2 where id=$1',[id,state]);
        await enqueue(c,state==='purging'?'storage-purge':state==='copying'?'storage-copy':'storage-finalize',id);return{ok:true};
      }
      if(action==='hash'&&request.method==='POST'){
        if(n.directory||n.state!=='ready')throw new HttpError(409,'Файл ещё не готов');
        await c.query("update storage_node set hash_state='queued' where id=$1",[id]);await enqueue(c,'storage-hash',id);return{ok:true};
      }
      if(action==='restore'&&request.method==='POST'){
        if(n.state!=='ready')throw new HttpError(409,'Сначала завершите текущую операцию');
        if(n.parent_id)await access(c,n.space_id,n.parent_id,u,true);
        await moveOnDisk(c,n,n.parent_id,n.name);
        await c.query('update storage_node set deleted_at=null,updated_at=now() where id=$1',[id]);await audit(c,u,'restore',n);return{ok:true};
      }
      if(action==='purge'&&request.method==='POST'){
        if(!n.deleted_at)throw new HttpError(400,'Сначала переместите файл в корзину');
        await c.query("update storage_node set state='purging' where id=$1",[id]);await enqueue(c,'storage-purge',id);await audit(c,u,'purge',n);return{ok:true};
      }
      if(request.method==='DELETE'){
        if(n.state==='uploading'){if(n.created_by!==u.id)throw new HttpError(403,'Чужая загрузка');await c.query("update storage_node set state='purging' where id=$1",[id]);await enqueue(c,'storage-purge',id);}
        else {if(n.state!=='ready')throw new HttpError(409,'Дождитесь завершения операции');await moveOnDisk(c,n,n.parent_id,n.name,true);await c.query('update storage_node set deleted_at=now() where id=$1',[id]);await audit(c,u,'trash',n);}return{ok:true};
      }
      if(action==='copy'&&request.method==='POST'){
        const dest=z.object({parentId:uuid.nullable(),name:nodeName}).parse(data);await parent(c,n.space_id,dest.parentId,u);
        await syncTree(c,n,u);
        const tree=await descendants(c,id);if(dest.parentId&&tree.some(item=>item.id===dest.parentId))throw new HttpError(400,'Нельзя копировать папку в себя');
        if(tree.some(item=>!['ready','missing'].includes(item.state)))throw new HttpError(409,'Дождитесь завершения операций');
        const mapping=new Map<string,string>();let copy:Node|undefined;
        for(const item of tree){if(item.deleted_at||item.state==='missing')continue;const parentId=item.id===id?dest.parentId:mapping.get(item.parent_id!);if(parentId===undefined)continue;
          const created=await createNode(c,u,{spaceId:n.space_id,parentId,name:item.id===id?dest.name:item.name,directory:item.directory,size:Number(item.size),mime:item.mime,state:item.directory?'ready':'copying',sourceId:item.directory?undefined:item.id});mapping.set(item.id,created.id);copy??=created;if(!item.directory)await enqueue(c,'storage-copy',created.id);}
        return publicNode(copy!);
      }
      if(request.method==='PATCH'){
        if(n.state!=='ready')throw new HttpError(409,'Дождитесь завершения операции');
        const v=z.object({name:nodeName.optional(),parentId:uuid.nullable().optional()}).parse(data),target=v.parentId===undefined?n.parent_id:v.parentId;
        await parent(c,n.space_id,target,u);if(target&&(await ancestors(c,target)).some(p=>p.id===id))throw new HttpError(400,'Нельзя переместить папку в себя');
        await moveOnDisk(c,n,target,v.name??n.name);
        await c.query('update storage_node set name=$2,parent_id=$3,updated_at=now() where id=$1',[id,v.name??n.name,target]);await audit(c,u,'move',n);return{ok:true};
      }
      throw new HttpError(404,'Не найдено');
    });
    if(request.method==='GET'&&parts[0]==='spaces'&&Array.isArray(result))return reply.send(await Promise.all(result.map(async space=>({...space,...await storageCapacity(space)}))));
    return reply.send(result);
  }catch(error){
    const status=error instanceof HttpError?error.status:error instanceof z.ZodError||error instanceof SyntaxError?400:(error as {code?:string}).code==='23505'?409:500;
    if(status===500)console.error('ERROR storage request failed');
    return reply.code(status).send({error:error instanceof HttpError?error.message:status===409?'Такое имя уже существует':status===400?'Проверьте введённые данные':'Не удалось выполнить операцию с файлами'});
  }
}
