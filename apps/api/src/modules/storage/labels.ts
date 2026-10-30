import path from 'node:path';
import type {PoolClient} from 'pg';
import {configuredStorages,providerKey} from './config';
import {uuid} from './validation';

type Entry={directory:boolean;name:string;filesystem_path?:unknown;display_name?:string};
// Labels are derived from Beacon identities. Physical paths and operation targets stay unchanged.
export async function displayLabels<T extends Entry>(client:PoolClient,spaceId:string,entries:T[]):Promise<(T&{display_name?:string})[]>{
 const {rows:[space]}=await client.query('select provider,owner_id,personal_folder_label from storage_space where id=$1',[spaceId]);
 if(!space||space.owner_id)return entries;
 const definitions=configuredStorages(),shared=definitions.find(d=>providerKey(d.id)===space.provider);
 const personal=definitions.find(d=>d.personal_parent!==undefined);
 if(!shared||!personal)return entries;
 const prefix=path.relative(shared.path,path.join(personal.path,personal.personal_parent!));
 if(!prefix||prefix.startsWith('../')||prefix==='..'||path.isAbsolute(prefix))return entries;
 const ids=new Map<T,string>();
 for(const entry of entries){
  if(!entry.directory||typeof entry.filesystem_path!=='string'||path.dirname(entry.filesystem_path)!==prefix||!entry.name.startsWith('user-'))continue;
  const id=entry.name.slice(5);if(uuid.safeParse(id).success)ids.set(entry,id);
 }
 const {rows:users}=ids.size?await client.query(`select id,trim(concat_ws(' ',nullif(first_name,''),nullif(last_name,''))) as full_name from "user" where id=any($1::uuid[])`,[[...ids.values()]]):{rows:[]};
 const names=new Map<string,string>(users.map(user=>[user.id,user.full_name||'Пользователь']));
 return entries.map(entry=>{
  if(!entry.directory)return entry;
  const label=entry.filesystem_path===prefix?space.personal_folder_label:names.get(ids.get(entry)??'');
  return label?{...entry,display_name:label}:entry;
 });
}
