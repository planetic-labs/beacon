import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, mkdir, readdir, open, unlink, rename, link, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FileStorage } from '../files/storage';
import { uuid } from './validation';
import { HttpError } from '../../lib/http';

const absent=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
export type DiskEntry={name:string;directory:boolean;size:number;mtime:string};
// UUIDs remain API identities. Only this adapter resolves them into filesystem paths.
export class MountedStorage implements FileStorage {
  constructor(private root:string,private client:PoolClient,private spaceId:string){}
  async path(relative:string,internal=false){
    const parts=relative.split('/');
    if(path.isAbsolute(relative)||parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')||/[\x00-\x1f\x7f]/.test(p)||(!internal&&p.startsWith('.'))))throw new HttpError(400,'Некорректный путь');
    let current=this.root;
    for(const part of parts){current=path.join(current,part);try{if((await lstat(current)).isSymbolicLink())throw new HttpError(400,'Символьные ссылки не поддерживаются');}catch(error){if(!absent(error))throw error;}}
    return current;
  }
  async relative(key:string):Promise<string>{
    const {rows:[n]}=await this.client.query('select filesystem_path from storage_node where id=$1 and space_id=$2',[key,this.spaceId]);
    if(!n?.filesystem_path)throw new HttpError(404,'Файл не найден на диске');return n.filesystem_path;
  }
  async file(key:string){const relative=await this.relative(key);return this.path(relative,relative.startsWith('.beacon-trash/'));}
  async info(key:string){try{const s=await lstat(await this.file(key));return{size:s.size};}catch(error){if(absent(error))return null;throw error;}}
  async readStream(key:string,start?:number,end?:number){const handle=await open(await this.file(key),constants.O_RDONLY|constants.O_NOFOLLOW);return handle.createReadStream({start,end,autoClose:true});}
  async read(key:string){const chunks:Buffer[]=[];for await(const chunk of await this.readStream(key))chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
  async save(key:string,bytes:Uint8Array){await this.saveStream(key,Readable.from([bytes]));}
  async saveStream(key:string,stream:Readable){await this.publish(key,stream);}
  async uploadDirectory(){
    const directory=await this.path('.beacon-uploads',true);await mkdir(directory,{recursive:true,mode:0o700});return directory;
  }
  async uploadFile(key:string){return this.path(`.beacon-uploads/${uuid.parse(key)}`,true);}
  async cleanupUpload(key:string){
    uuid.parse(key);
    for(const suffix of ['', '.json', '.part'])await unlink(await this.path(`.beacon-uploads/${key}${suffix}`,true)).catch(error=>{if(!absent(error))throw error;});
  }
  async finishUpload(key:string,expectedSize:number){
    const temporary=await this.uploadFile(key);
    const handle=await open(temporary,constants.O_RDWR|constants.O_NOFOLLOW);
    let digest:string;
    try{
      const info=await handle.stat();if(!info.isFile()||info.size!==expectedSize)throw new Error('Upload size mismatch');
      await handle.sync();
      const hash=createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk);
      const after=await handle.stat();if(after.size!==info.size||after.mtimeMs!==info.mtimeMs)throw new Error('Upload changed during verification');
      digest=hash.digest('hex');
    }finally{await handle.close();}
    const destination=await this.file(key);
    try{await link(temporary,destination);}catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      // Retry after publication but before SQL commit; never replace an unrelated file.
      const existing=createHash('sha256');for await(const chunk of await this.readStream(key))existing.update(chunk);
      if(existing.digest('hex')!==digest)throw new HttpError(409,'Такое имя уже существует');
    }
    const info=await lstat(destination,{bigint:true});
    // Retain the staging link until the catalog commits. Both links reference the same bytes.
    return{size:expectedSize,sha256:digest,mtime:String(info.mtimeNs)};
  }
  async publish(key:string,stream:Readable,expectedSize?:number){
    const directory=await this.path('.beacon-uploads',true);await mkdir(directory,{recursive:true});
    const temporary=await this.path(`.beacon-uploads/${key}.part`,true);
    await unlink(temporary).catch(error=>{if(!absent(error))throw error;});
    const handle=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);
    const hash=createHash('sha256');let size=0;let digest:string;
    try{
      for await(const value of stream){const bytes=Buffer.from(value);hash.update(bytes);size+=bytes.length;let offset=0;while(offset<bytes.length){const written=await handle.write(bytes,offset,bytes.length-offset);if(!written.bytesWritten)throw new Error('Short filesystem write');offset+=written.bytesWritten;}}
      await handle.sync();
      digest=hash.digest('hex');
      if(expectedSize!==undefined&&size!==expectedSize)throw new Error('Upload size mismatch');
      // Verify the same open file that received the bytes, without reopening its path.
      const verified=createHash('sha256');
      for await(const chunk of handle.createReadStream({start:0,autoClose:false}))verified.update(chunk);
      if(verified.digest('hex')!==digest)throw new Error('Upload checksum mismatch');
    }finally{await handle.close();}
    const destination=await this.file(key);
    // Hard-link publication is atomic and refuses an existing destination, unlike rename.
    // Keep the staging file for retries if the mounted filesystem cannot publish safely.
    try{await link(temporary,destination);}catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      // A worker may have published successfully just before its SQL transaction rolled back.
      const existing=createHash('sha256');for await(const chunk of await this.readStream(key))existing.update(chunk);
      if(existing.digest('hex')!==digest)throw new HttpError(409,'Такое имя уже существует');
    }
    await unlink(temporary);
    const info=await lstat(destination,{bigint:true});return{size,sha256:digest,mtime:String(info.mtimeNs)};
  }
  async remove(key:string){
    const relative=await this.relative(key);
    // Cancellation only removes staging. Never unlink a destination reserved by an
    // unfinished upload: another filesystem writer may have created it meanwhile.
    await this.cleanupUpload(key);
    if(!relative.startsWith('.beacon-trash/'))return;
    await rm(await this.path(relative,true),{recursive:true,force:true});
  }
  async list(relative:string|null):Promise<DiskEntry[]>{
    const directory=relative?await this.path(relative):this.root;
    const entries=await readdir(directory,{withFileTypes:true});const result:DiskEntry[]=[];
    for(const entry of entries){if(entry.name.startsWith('.')||/[\\\x00-\x1f\x7f]/.test(entry.name)||entry.isSymbolicLink()||(!entry.isDirectory()&&!entry.isFile()))continue;
      const file=await this.path(relative?`${relative}/${entry.name}`:entry.name);
      try{const s=await lstat(file,{bigint:true});if(s.isSymbolicLink())continue;result.push({name:entry.name,directory:s.isDirectory(),size:s.isDirectory()?0:Number(s.size),mtime:String(s.mtimeNs)});}catch(error){if(!absent(error))throw error;}
    }return result;
  }
  async exists(relative:string){try{await lstat(await this.path(relative));return true;}catch(error){if(absent(error))return false;throw error;}}
  async makeDirectory(relative:string){await mkdir(await this.path(relative));}
  async move(from:string,to:string){
    const source=await this.path(from,from.startsWith('.beacon-trash/')),destination=await this.path(to,to.startsWith('.beacon-trash/'));
    try{await lstat(destination);throw new HttpError(409,'Такое имя уже существует');}catch(error){if(!absent(error))throw error;}
    if(to.startsWith('.beacon-trash/'))await mkdir(await this.path('.beacon-trash',true),{recursive:true});
    await rename(source,destination);
  }
}
