import { PgBoss } from "pg-boss";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../../db";
import { storageForSpace } from "./provider";
import { node, transaction, descendants } from "./service";
let running:Promise<PgBoss>|undefined;
const options={retryLimit:5,retryDelay:10,retryBackoff:true,expireInSeconds:86400};
export function storageJobs() {
  return running ??= (async()=>{
    const boss=new PgBoss({connectionString:process.env.DATABASE_URL!,schema:process.env.APP_ENV==='test'?(process.env.STORAGE_JOBS_SCHEMA??'storage_jobs'):'storage_jobs',max:3});
    boss.on('error',()=>console.error('ERROR storage background job failed'));
    await boss.start();
    for(const name of ['storage-finalize','storage-copy','storage-hash','storage-purge','storage-cleanup'])await boss.createQueue(name,options);
    for(const [name,handler] of [['storage-finalize',(id:string)=>materialize(id,true)],['storage-copy',(id:string)=>materialize(id,false)],['storage-hash',hash],['storage-purge',purge]] as const){
      await boss.work(name,{includeMetadata:true},async jobs=>{for(const job of jobs){const {id}=job.data as {id:string};try{await handler(id);}catch(error){if(job.retryCount>=job.retryLimit)await pool.query(name==='storage-hash'?"update storage_node set hash_state='error' where id=$1":"update storage_node set state='error' where id=$1 and state in ('processing','copying','purging')",[id]);throw error;}}});
    }
    await boss.work('storage-cleanup',async()=>{
      const {rows}=await pool.query(`select id from storage_node where state='uploading' and created_at<now()-interval '7 days'`);
      for(const {id} of rows)await transaction(async c=>{await c.query("update storage_node set state='purging' where id=$1 and state='uploading'",[id]);await enqueue(c,'storage-purge',id,boss);});
    });
    await boss.schedule('storage-cleanup','17 * * * *',{});
    return boss;
  })().catch(error=>{running=undefined;throw error;});
}
export async function stopStorageJobs(){if(running)await(await running).stop();running=undefined;}
export async function enqueue(client:PoolClient,name:string,id:string,instance?:PgBoss){
  const boss=instance??await storageJobs();
  return boss.send(name,{id},{...options,db:{executeSql:async(text,values)=>client.query(text,values)},singletonKey:id});
}
async function materialize(id:string,upload:boolean){
  const storage=await transaction(async client=>{
    const n=await node(client,id);
    if(upload&&n.state==='ready')return storageForSpace(client,n.space_id);
    if(!['processing','copying'].includes(n.state))return;
    const storage=await storageForSpace(client,n.space_id);
    const verified=upload?await storage.finishUpload(id,Number(n.size)):await storage.publish(id,await storage.readStream(n.source_id!),Number(n.size));
    await client.query("update storage_node set state='ready',source_id=null,sha256=$2,hash_state='ready',filesystem_mtime=$3,updated_at=now() where id=$1",[id,verified.sha256,verified.mtime]);
    return storage;
  },false);
  if(upload&&storage)await storage.cleanupUpload(id);
}
async function hash(id:string){
  try{await transaction(async client=>{
    const n=await node(client,id);if(n.state!=='ready'||n.directory||n.deleted_at)return;
    const storage=await storageForSpace(client,n.space_id);
    const digest=createHash('sha256');for await(const chunk of await storage.readStream(id))digest.update(chunk);
    await client.query("update storage_node set sha256=$2,hash_state='ready' where id=$1",[id,digest.digest('hex')]);
  },false);}catch(error){await pool.query("update storage_node set hash_state='error' where id=$1",[id]);throw error;}
}
async function purge(id:string){
  await transaction(async client=>{
    const result=await client.query('select * from storage_node where id=$1',[id]);if(!result.rows.length)return;
    if(result.rows[0].state!=='purging')return;
    const storage=await storageForSpace(client,result.rows[0].space_id);
    const items=await descendants(client,id);
    await client.query('select id from storage_node where id=any($1::uuid[]) order by id for update',[items.map(n=>n.id)]);
    // Copies retain the source until all queued materializations have finished.
    const {rows:[busy]}=await client.query("select 1 from storage_node where source_id=any($1::uuid[]) and not(id=any($1::uuid[])) limit 1",[items.map(n=>n.id)]);
    if(busy)throw new Error('File has pending copies');
    for(const n of [...items].reverse()){if(n.filesystem_path)await storage.remove(n.id);}
    await client.query('delete from storage_node where id=any($1::uuid[])',[items.map(n=>n.id)]);
  });
}
