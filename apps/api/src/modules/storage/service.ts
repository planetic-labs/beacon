import { storageForSpace } from "./provider";
import { configuredStorages, activeProviders, providerKey } from "./config";
import { pool } from "../../db";
import type { PoolClient } from "pg";
import { HttpError } from "../../lib/http";
import { v7 } from "uuid";
import { nodeName, guessedMime } from "./validation";
export type User = {id:string;role:string};
export type Node = {id:string;space_id:string;parent_id:string|null;name:string;directory:boolean;created_by:string;state:string;size:string;mime:string;deleted_at:string|null;sha256:string|null;hash_state:string;source_id:string|null;[key:string]:unknown};
export async function transaction<T>(run:(client:PoolClient)=>Promise<T>, serialize=true) {
  const client=await pool.connect();
  try { await client.query("begin"); if(serialize)await client.query("select pg_advisory_xact_lock(917342)"); const result=await run(client); await client.query("commit"); return result; }
  catch(error) { await client.query("rollback"); throw error; } finally {client.release();}
}
export async function syncConfiguredSpaces(client:PoolClient){
  for(const entry of configuredStorages().filter(item=>item.personal_parent===undefined)){
    const key=providerKey(entry.id);
    const {rows:[existing]}=await client.query('select * from storage_space where provider=$1 and owner_id is null',[key]);
    if(existing)await client.query('update storage_space set name=$2 where id=$1',[existing.id,entry.name]);
    else await client.query('insert into storage_space(id,name,provider) values($1,$2,$3)',[v7(),entry.name,key]);
  }
}
export async function space(client:PoolClient,id:string,u:User) {
  const {rows:[s]}=await client.query('select * from storage_space where id=$1',[id]);
  if(!s || (s.owner_id && (s.owner_id!==u.id||!configuredStorages().some(item=>item.personal_parent!==undefined&&providerKey(item.id)===s.provider))) || (!s.owner_id&&!activeProviders().includes(s.provider))) throw new HttpError(404,"Хранилище не найдено");
  return s;
}
export async function node(client:PoolClient,id:string):Promise<Node> {
  const {rows:[n]}=await client.query('select * from storage_node where id=$1 for update',[id]);
  if(!n) throw new HttpError(404,"Файл не найден"); return n;
}
export async function ancestors(client:PoolClient,id:string|null) {
  return (await client.query(`with recursive parents as (select * from storage_node where id=$1 union all select n.* from storage_node n join parents p on n.id=p.parent_id) select * from parents`,[id])).rows as Node[];
}
export async function access(client:PoolClient,spaceId:string,nodeId:string|null,u:User,write=false,allowTrash=false) {
  const s=await space(client,spaceId,u);
  const chain=await ancestors(client,nodeId);
  if(nodeId && (!chain.length || chain[0].space_id!==spaceId))throw new HttpError(404,"Файл не найден");
  if(!allowTrash && chain.some(n=>n.deleted_at || n.state==='purging'||n.state==='missing'))throw new HttpError(404,"Файл не найден");
  if(s.owner_id===u.id || u.role==='admin')return;
  const {rows}=await client.query(`select 1 from storage_grant g join group_member m on m.group_id=g.group_id where g.space_id=$1 and m.user_id=$2 and (g.node_id is null or g.node_id=any($3::uuid[])) and ($4=false or g.access='write') limit 1`,[spaceId,u.id,chain.map(n=>n.id),write]);
  if(!rows.length)throw new HttpError(403,"Нет доступа к этой папке");
}
export async function parent(client:PoolClient,spaceId:string,parentId:string|null,u:User) {
  await access(client,spaceId,parentId,u,true);
  await storageForSpace(client,spaceId);
  if(parentId){const p=await node(client,parentId);if(!p.directory||p.state!=='ready')throw new HttpError(409,"Папка недоступна");}
}
export async function personal(client:PoolClient,u:User) {
  const entry=configuredStorages().find(item=>item.personal_parent!==undefined);
  if(!entry)return;
  return (await client.query(`insert into storage_space(id,name,owner_id,provider) values($1,$2,$3,$4) on conflict(owner_id) do update set name=excluded.name,provider=excluded.provider returning *`,[v7(),entry.name,u.id,providerKey(entry.id)])).rows[0];
}
export async function audit(client:PoolClient,u:User,action:string,n:Pick<Node,'id'|'space_id'>) {
  await client.query('insert into storage_audit(id,user_id,action,node_id,space_id) values($1,$2,$3,$4,$5)',[v7(),u.id,action,n.id,n.space_id]);
}
export async function createNode(client:PoolClient,u:User,input:{spaceId:string;parentId:string|null;name:string;directory:boolean;size?:number;mime?:string;state?:string;sourceId?:string}) {
  await parent(client,input.spaceId,input.parentId,u);
  await syncDirectory(client,input.spaceId,input.parentId,u);
  const storage=await storageForSpace(client,input.spaceId);
  const prefix=input.parentId?(await node(client,input.parentId)).filesystem_path as string:null;
  const fsPath=prefix?`${prefix}/${input.name}`:input.name;
  if(await storage.exists(fsPath))throw new HttpError(409,"Такое имя уже существует");
  const {rows:[n]}=await client.query(`insert into storage_node(id,space_id,parent_id,name,directory,created_by,size,mime,state,source_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,[v7(),input.spaceId,input.parentId,nodeName.parse(input.name),input.directory,u.id,input.size??0,input.mime??'application/octet-stream',input.state??'ready',input.sourceId??null]);
  await client.query('update storage_node set filesystem_path=$2 where id=$1',[n.id,fsPath]);n.filesystem_path=fsPath;
  if(input.directory)await storage.makeDirectory(fsPath);
  await audit(client,u,input.directory?'mkdir':'create',n);return n as Node;
}
export async function descendants(client:PoolClient,id:string) {
  return (await client.query(`with recursive tree as(select *,0 as depth from storage_node where id=$1 union all select n.*,t.depth+1 from storage_node n join tree t on n.parent_id=t.id) select * from tree order by depth,id`,[id])).rows as Node[];
}
export function publicNode(n:Node) {const {filesystem_path,filesystem_mtime,...visible}=n;return {...visible,size:Number(n.size)};}

// Refresh only the opened directory. Files created by other applications appear immediately;
// vanished objects keep their IDs/visits but cannot be downloaded as stale catalog entries.
export async function syncDirectory(client:PoolClient,spaceId:string,parentId:string|null,u:User){
  const storage=await storageForSpace(client,spaceId);
  const p=parentId?await node(client,parentId):null;
  if(p&&(!p.directory||p.state!=='ready'||p.deleted_at))throw new HttpError(404,'Папка не найдена');
  const relative=p?.filesystem_path as string|null??null;
  if(p&&!relative)throw new HttpError(404,'Папка не найдена на диске');
  const disk=await storage.list(relative);
  const {rows:known}=await client.query('select * from storage_node where space_id=$1 and parent_id is not distinct from $2::uuid and deleted_at is null',[spaceId,parentId]);
  const seen=new Set<string>();
  for(const item of disk){
    let n=known.find(n=>n.name===item.name&&n.state!=="missing")??known.find(n=>n.name===item.name);seen.add(item.name);
    if(n&&['ready','missing'].includes(n.state)&&n.directory!==item.directory){await client.query("update storage_node set state='missing' where id=$1",[n.id]);n=undefined;}
    const fsPath=relative?`${relative}/${item.name}`:item.name;
    if(n){
      if(!['ready','missing'].includes(n.state))continue;
      if(n.directory!==item.directory)continue;
      await client.query(`update storage_node set filesystem_path=$2,filesystem_mtime=$3,size=$4,state='ready',sha256=case when filesystem_mtime=$3 and size=$4 then sha256 else null end,hash_state=case when filesystem_mtime=$3 and size=$4 then hash_state else 'none' end,updated_at=case when filesystem_mtime=$3 and size=$4 then updated_at else now() end where id=$1`,[n.id,fsPath,item.mtime,item.size]);
    }else await client.query(`insert into storage_node(id,space_id,parent_id,name,directory,created_by,size,mime,filesystem_path,filesystem_mtime) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[v7(),spaceId,parentId,item.name,item.directory,u.id,item.size,guessedMime(item.name),fsPath,item.mtime]);
  }
  for(const n of known)if(!seen.has(n.name)&&n.state==='ready')await client.query("update storage_node set state='missing',sha256=null,hash_state='none' where id=$1",[n.id]);
}
export async function syncTree(client:PoolClient,n:Node,u:User){
  if(!n.directory)return;
  await syncDirectory(client,n.space_id,n.id,u);
  const {rows}=await client.query("select * from storage_node where parent_id=$1 and directory and deleted_at is null and state='ready'",[n.id]);
  for(const child of rows)await syncTree(client,child,u);
}
export async function moveOnDisk(client:PoolClient,n:Node,parentId:string|null,name:string,trash=false){
  const storage=await storageForSpace(client,n.space_id);
  const prefix=parentId?(await node(client,parentId)).filesystem_path as string:null;
  const destination=trash?`.beacon-trash/${n.id}`:prefix?`${prefix}/${name}`:name;
  const source=n.filesystem_path as string;
  if(source===destination)return;
  await storage.move(source,destination);
  const tree=await descendants(client,n.id);
  for(const item of tree){const old=item.filesystem_path as string|null;if(old&&(old===source||old.startsWith(source+'/')))await client.query('update storage_node set filesystem_path=$2 where id=$1',[item.id,destination+old.slice(source.length)]);}
}
