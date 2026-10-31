import path from "node:path";
import { readFile,stat,lstat,mkdir,statfs } from "node:fs/promises";
import type { PoolClient } from "pg";
import { MountedStorage } from "./filesystem";
import { configuredStorages,providerKey } from "./config";
import { HttpError } from "../../lib/http";
// Storage definitions select filesystem roots, including each space's Tus staging directory.
export const filesRoot=()=>process.env.STORAGE_ROOT??path.join(process.env.MEDIA_ROOT??'/data/media','storage');
export async function storageForSpace(client:PoolClient,spaceId:string){
  const {rows:[space]}=await client.query('select id,owner_id,provider from storage_space where id=$1',[spaceId]);
  if(!space)throw new HttpError(404,'Хранилище не найдено');
  return new MountedStorage(await rootForSpace(space),client,spaceId);
}
type SpaceDescriptor={owner_id:string|null;provider:string};
async function rootForSpace(space:SpaceDescriptor){
  const config=configuredStorages().find(item=>providerKey(item.id)===space.provider);
  if(!config||(space.owner_id?config.personal_parent===undefined:config.personal_parent!==undefined))throw new HttpError(404,'Хранилище отключено в конфигурации');
  try{
    if(config.mode==='local'&&path.resolve(config.path)===path.resolve(filesRoot()))await mkdir(config.path,{recursive:true});
    if(!(await stat(config.path)).isDirectory())throw new Error();
    if(config.mode==='sshfs'){
      const mounts=await readFile('/proc/self/mountinfo','utf8');
      const mounted=mounts.split('\n').some(line=>{
        const [mount,filesystem]=line.split(' - ');if(!filesystem)return false;
        const point=mount.split(' ')[4]?.replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)));
        return point===path.resolve(config.path)&&filesystem.split(' ')[0]==='fuse.sshfs';
      });
      if(!mounted)throw new Error();
    }
  }catch{throw new HttpError(503,'Хранилище недоступно: проверьте подключение диска');}
  const root=space.owner_id?path.join(config.path,config.personal_parent!,`user-${space.owner_id}`):config.path;
  // Validate every private prefix before mkdir: a symlink must never escape the mount.
  if(space.owner_id){
    let current=config.path;
    for(const part of path.relative(config.path,root).split(path.sep)){
      current=path.join(current,part);
      try{if((await lstat(current)).isSymbolicLink())throw new HttpError(400,'Символьные ссылки не поддерживаются');}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await mkdir(current);}
    }
  }
  return root;
}

async function readCapacity(space:SpaceDescriptor):Promise<{online:boolean;free:number|null;total:number|null}>{
  try{await rootForSpace(space);}catch{return{online:false,free:null,total:null};}
  const config=configuredStorages().find(item=>providerKey(item.id)===space.provider)!;
  try{
    const stats=await statfs(config.path,{bigint:true});
    const total=Number(stats.blocks*stats.bsize),free=Number(stats.bavail*stats.bsize);
    if(!Number.isFinite(total)||total<=0||!Number.isFinite(free))return{online:true,free:null,total:null};
    return{online:true,total,free:Math.max(0,Math.min(total,free))};
  }catch{return{online:true,free:null,total:null};}
}

// Slow remote mounts must not delay the entire sidebar or hold a database transaction.
export async function storageCapacity(space:SpaceDescriptor){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([readCapacity(space),new Promise<{online:boolean;free:null;total:null}>(resolve=>{timer=setTimeout(()=>resolve({online:false,free:null,total:null}),2000);})]);}
  finally{clearTimeout(timer);}
}
