import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance } from "fastify";
import { Server, DataStore, type Locker, type Lock, type Upload } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fromNodeHeaders } from "better-auth/node";
import { actor, adminOnly, checkOrigin, HttpError } from "../../lib/http";
import { pool } from "../../db";
import { access, node, transaction } from "../../modules/storage/service";
import { enqueue } from "../../modules/storage/jobs";
import { storageForSpace } from "../../modules/storage/provider";
import { uuid, maxUploadSize } from "../../modules/storage/validation";
// PostgreSQL locks protect offsets even when several HTTP instances share the disk.
class UploadLocker implements Locker {
  newLock(id:string):Lock {
    let client:import('pg').PoolClient|undefined;
    return {async lock(signal){
      uuid.parse(id);client=await pool.connect();
      const {rows:[result]}=await client.query('select pg_try_advisory_lock(hashtextextended($1,917343)) as locked',[id]);
      if(!result.locked||signal.aborted){if(result.locked)await client.query('select pg_advisory_unlock(hashtextextended($1,917343))',[id]);client.release();client=undefined;throw {status_code:423,body:'Загрузка занята, повторите запрос'};}
    },async unlock(){if(client){try{await client.query('select pg_advisory_unlock(hashtextextended($1,917343))',[id]);}finally{client.release();client=undefined;}}}};
  }
}
class ExclusiveFileStore extends FileStore {
  override async create(file:Upload){
    await mkdir(this.directory,{recursive:true});
    try{const handle=await open(path.join(this.directory,uuid.parse(file.id)),'wx',0o600);await handle.close();}
    catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw{status_code:409,body:'Загрузка уже существует. Продолжите её по сохранённому адресу.'};throw error;}
    await this.configstore.set(file.id,file);
    file.storage={type:'file',path:path.join(this.directory,file.id)};return file;
  }
}
// Route each Tus operation to its mounted space; the standard FileStore still handles
// chunk writes, offsets and resumable metadata. No upload bytes pass through a local spool.
const uploadStores=new AsyncLocalStorage<Map<string,ExclusiveFileStore>>();
class MountedFileStore extends DataStore {
  override extensions=['creation','creation-with-upload','termination'];
  async prepare(id:string,spaceId:string,client:import('pg').PoolClient){
    uuid.parse(id);
    const storage=await storageForSpace(client,spaceId);
    const directory=await storage.uploadDirectory();
    await storage.uploadFile(id);await storage.path(`.beacon-uploads/${id}.json`,true);
    const context=uploadStores.getStore();if(!context)throw new Error('Missing upload request context');
    context.set(id,new ExclusiveFileStore({directory}));
  }
  private store(id:string){
    const store=uploadStores.getStore()?.get(uuid.parse(id));
    if(!store)throw new Error('Upload destination was not authorized');return store;
  }
  override async create(file:Upload){return this.store(file.id).create(file);}
  override async getUpload(id:string){return this.store(id).getUpload(id);}
  override async write(...args:Parameters<FileStore['write']>){return this.store(args[1]).write(...args);}
  override async remove(id:string){return this.store(id).remove(id);}
}
export async function tusRoutes(app:FastifyInstance){
  const store=new MountedFileStore();
  const tus=new Server({path:'/api/storage/uploads',datastore:store,locker:new UploadLocker(),maxSize:maxUploadSize,relativeLocation:true,disableTerminationForFinishedUploads:true,
    namingFunction:async(req,metadata)=>{
      const u=await actor(req.headers);adminOnly(u);const id=uuid.parse(metadata?.nodeId);
      await transaction(async c=>{const n=await node(c,id);await access(c,n.space_id,id,u,true);if(n.created_by!==u.id||n.state!=='uploading')throw new HttpError(403,'Загрузка недоступна');const rawLength=req.headers.get('upload-length');const length=Number(rawLength);if(!rawLength||!/^(0|[1-9]\d*)$/.test(rawLength)||!Number.isSafeInteger(length)||length!==Number(n.size))throw new HttpError(400,'Неверный размер файла');});return id;
    },
    onIncomingRequest:async(req,id)=>{
      if(!['HEAD','OPTIONS'].includes(req.method))checkOrigin(req);const u=await actor(req.headers);adminOnly(u);
      if(id)await transaction(async c=>{const n=await node(c,uuid.parse(id));await access(c,n.space_id,id,u,true);if(n.created_by!==u.id||!['uploading','processing','ready'].includes(n.state))throw new HttpError(404,'Загрузка не найдена');await store.prepare(id,n.space_id,c);if(req.method==='HEAD'&&n.state==='uploading'){const saved=await store.getUpload(id);if(saved.size===saved.offset){await c.query("update storage_node set state='processing' where id=$1",[id]);await enqueue(c,'storage-finalize',id);}}});
      if(req.method==='DELETE')throw new HttpError(405,'Используйте отмену загрузки');
    },
    onUploadFinish:async(_req,upload)=>{
      await transaction(async c=>{const n=await node(c,upload.id);if(n.state==='uploading'){await c.query("update storage_node set state='processing' where id=$1",[n.id]);await enqueue(c,'storage-finalize',n.id);}});return{};
    },
    onResponseError:(_req,error)=>{if(error instanceof HttpError)return{status_code:error.status,body:error.message};return undefined;},
  });
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*',(req,_payload,done)=>done(null,req.raw));
  for(const url of ['/api/storage/uploads','/api/storage/uploads/:uploadId'])app.route({method:['POST','PATCH','HEAD','OPTIONS','DELETE'],url,handler:async(req,reply)=>{
    const init:RequestInit&{duplex?:string}={method:req.method,headers:fromNodeHeaders(req.headers)};
    if(['POST','PATCH'].includes(req.method)){init.body=Readable.toWeb(req.raw) as ReadableStream<Uint8Array>;init.duplex='half';}
    const response=await uploadStores.run(new Map(),()=>tus.handleWeb(new Request(new URL(req.url,process.env.APP_URL),init)));
    reply.code(response.status);response.headers.forEach((v,k)=>reply.header(k,v));
    return reply.send(response.body?Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>):null);
  }});
}
