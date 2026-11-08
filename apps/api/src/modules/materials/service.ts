import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import type {FileHandle} from 'node:fs/promises';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {HttpError} from '../../lib/http';
import {ancestors,access,node,transaction,syncDirectory,type User,type Node} from '../storage/service';
import {storageForSpace} from '../storage/provider';
import {guessedMime} from '../storage/validation';
import type {Material,MaterialKind} from '@beacon/shared';
const label=z.string().trim().min(1).max(240);
export const materialInput=z.object({title:label,description:z.string().max(20000).default(''),coverId:z.uuid().nullable().default(null),reviewed:z.boolean().default(false),chapters:z.array(z.object({seconds:z.number().int().nonnegative(),title:label})).max(500).default([])}).strict();
export function fileMime(n:Pick<Node,'name'|'mime'>){return n.mime==='application/octet-stream'?guessedMime(n.name):n.mime;}
export function fileKind(n:Pick<Node,'name'|'mime'>):MaterialKind{const mime=fileMime(n);return mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':mime.startsWith('image/')?'image':'document';}
export async function readyFile(c:PoolClient,id:string,lock=false){
 const n:Node|undefined=lock?await node(c,id):(await c.query('select * from storage_node where id=$1',[id])).rows[0];
 if(!n||n.directory||(await ancestors(c,id)).some(p=>p.deleted_at||p.state!=='ready'))throw new HttpError(404,'Файл недоступен');
 const storage=await storageForSpace(c,n.space_id);let handle:FileHandle;
 try{handle=await storage.openRead(n.id);}catch{throw new HttpError(404,'Файл недоступен');}
 try{const s=await handle.stat({bigint:true});if(!s.isFile())throw new HttpError(404,'Файл недоступен');return{n,handle,size:Number(s.size),fingerprint:`${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`};}
 catch(error){await handle.close();throw error;}
}
async function fingerprint(h:FileHandle){const s=await h.stat({bigint:true});return`${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;}
async function hash(h:FileHandle){const result=createHash('sha256');for await(const bytes of h.createReadStream({start:0,autoClose:false}))result.update(bytes);return result.digest('hex');}
async function probe(h:FileHandle,n:Node){
 const mime=fileMime(n),kind=fileKind(n),format=({'video/mp4':'mov','audio/mpeg':'mp3','audio/ogg':'ogg','audio/wav':'wav','audio/x-wav':'wav','audio/mp4':'mov','audio/aac':'aac','audio/flac':'flac'} as Record<string,string>)[mime];
 if(!format)throw new HttpError(400,'Формат записи не поддерживается для просмотра');
 const metadata=await new Promise<any>((resolve,reject)=>{
  const child=spawn('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-f',format,'-show_streams','-show_format','-of','json','/proc/self/fd/3'],{stdio:['ignore','pipe','pipe',h.fd]});
  let output='',length=0;const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('timeout'));},15000);
  child.stdout!.on('data',(bytes:Buffer)=>{length+=bytes.length;if(length>512*1024){child.kill('SIGKILL');reject(Error('metadata too large'));}else output+=bytes.toString();});
  child.stderr!.resume();child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(Error('probe failed'));else try{resolve(JSON.parse(output));}catch(e){reject(e);}});
 });
 const streams=metadata.streams as {codec_type:string;codec_name:string;pix_fmt?:string;disposition?:{attached_pic?:number}}[];
 const video=streams.filter(s=>s.codec_type==='video'&&!s.disposition?.attached_pic),audio=streams.filter(s=>s.codec_type==='audio'),duration=Number(metadata.format?.duration);
 if(!Number.isFinite(duration)||duration<=0)throw Error('Invalid duration');
 if(kind==='video'&&(video.length!==1||video[0].codec_name!=='h264'||!['yuv420p','yuvj420p'].includes(video[0].pix_fmt??'')||audio.some(s=>s.codec_name!=='aac')))throw Error('Unsupported MP4');
 if(kind==='audio'&&(video.length||!audio.length||audio.some(s=>!['mp3','aac','vorbis','opus','pcm_s16le','pcm_s24le','pcm_s32le','pcm_f32le','flac'].includes(s.codec_name))))throw Error('Unsupported audio');
 return Math.ceil(duration);
}
type Check={digest?:string;duration?:number;error?:boolean;finished?:number};
const checks=new Map<string,Check>();let running=0;
function checkFile(id:string,file:Awaited<ReturnType<typeof readyFile>>){
 const key=id+'/'+file.fingerprint,old=checks.get(key);
 if(old&&(!old.error||Date.now()-(old.finished??0)<10000))return{result:old,owns:false};
 if(running>=2)return{result:{} as Check,owns:false};
 const result:Check={};checks.set(key,result);running++;
 void(async()=>{try{
  const av=['video','audio'].includes(fileKind(file.n));
  const duration=av?await probe(file.handle,file.n):0;
  const digest=av?await hash(file.handle):file.n.sha256||file.fingerprint;
  if(await fingerprint(file.handle)!==file.fingerprint)throw Error('Changed while checking');
  result.duration=duration;result.digest=digest;
 }catch{result.error=true;}finally{result.finished=Date.now();await file.handle.close().catch(()=>{});running--;for(const[k,v]of checks){if(checks.size<=50)break;if(v.finished)checks.delete(k);}}})();
 return{result,owns:true};
}
// Discover external filesystem additions without holding up the catalogue request.
const scans=new Map<string,{running:boolean;finished:number}>();let scanning=0;
export function scheduleFolderScan(folder:Node){
 const old=scans.get(folder.id);if(old?.running)return true;if(old&&Date.now()-old.finished<30000||scanning>=2)return false;
 const state={running:true,finished:0};scans.set(folder.id,state);scanning++;
 void transaction(async c=>{
  const n=(await c.query('select n.* from storage_node n join storage_material_folder f on f.folder_id=n.id where n.id=$1 and f.enabled',[folder.id])).rows[0];
  if(!n||(await ancestors(c,n.id)).some(p=>p.deleted_at||p.state!=='ready'))return;
  await syncDirectory(c,n.space_id,n.id,{id:n.created_by,role:'user'});
 },false).catch(()=>{}).finally(()=>{state.running=false;state.finished=Date.now();scanning--;if(scans.size>200)for(const[k,v]of scans)if(!v.running&&Date.now()-v.finished>30000)scans.delete(k);});
 return true;
}
export async function folderPublished(c:PoolClient,n:Node){
 const enabled=(await c.query('select 1 from storage_material_folder where folder_id=$1 and enabled union all select 1 from material_playlist p join material_playlist_item i on i.playlist_id=p.id where p.enabled and i.material_id=$2 limit 1',[n.parent_id,n.id])).rowCount;
 return !!enabled&&!(await ancestors(c,n.id)).some(p=>p.deleted_at||p.state!=='ready');
}
export async function ensureCard(c:PoolClient,n:Node){
 if(n.directory)throw new HttpError(400,'Карточка относится к файлу');
 const existing=(await c.query('select * from material where id=$1',[n.id])).rows[0];if(existing)return existing;
 await c.query(`insert into material(id,title,duration,source_hash,fingerprint,created_by) values($1,'',0,'','',$2) on conflict(id) do nothing`,[n.id,n.created_by]);
 return(await c.query('select * from material where id=$1',[n.id])).rows[0];
}
type Inspection={available:boolean;checking:boolean;queued:boolean;finished:number};
const inspections=new Map<string,Inspection>(),inspectionQueue:{id:string;u:User;state:Inspection}[]=[];let inspecting=0;
function pumpInspections(){
 while(inspecting<2&&inspectionQueue.length){const task=inspectionQueue.shift()!;inspecting++;
  void transaction(c=>loadMaterial(c,task.id,task.u),false).then(card=>{task.state.available=card.available;task.state.checking=!!card.checking;}).catch(()=>{task.state.available=false;task.state.checking=false;}).finally(()=>{task.state.queued=false;task.state.finished=Date.now();inspecting--;pumpInspections();if(inspections.size>2000)for(const[k,v]of inspections)if(!v.queued&&Date.now()-v.finished>60000)inspections.delete(k);});
 }
}
function inspectLater(id:string,u:User,known:boolean){
 let state=inspections.get(id);if(!state){state={available:known,checking:true,queued:false,finished:0};inspections.set(id,state);}
 if(!state.queued&&Date.now()-state.finished>(state.checking?2000:30000)){state.queued=true;inspectionQueue.push({id,u,state});pumpInspections();}
 return state;
}
export async function loadMaterial(c:PoolClient,id:string,u:User,inspect=true):Promise<Material>{
 const n:Node|undefined=(await c.query('select * from storage_node where id=$1',[id])).rows[0];if(!n)throw new HttpError(404,'Файл не найден');
 const m=await ensureCard(c,n),kind=fileKind(n);let available=true,pending=false;
 if(!inspect){const state=inspectLater(id,u,!!m.fingerprint&&!m.needs_review);available=state.available;pending=state.checking||state.queued;}
 else try{
  const file=await readyFile(c,id);let owns=false;
  try{if(file.fingerprint!==m.fingerprint){
   const av=['video','audio'].includes(kind),check=av?checkFile(id,file):{result:{digest:file.n.sha256||file.fingerprint,duration:0} as Check,owns:false};owns=check.owns;const {digest,duration}=check.result;
   if(!digest){available=false;pending=!check.result.error;}
   else{
    const changed=!!m.source_hash&&digest!==m.source_hash;
    const review=changed&&['video','audio'].includes(kind)||m.needs_review;
    const updated=await c.query('update material set source_hash=$2,fingerprint=$3,duration=$4,needs_review=$5,revision=revision+$6 where id=$1 and fingerprint=$7 and revision=$8 returning revision',[id,digest,file.fingerprint,duration,review,changed?1:0,m.fingerprint,m.revision]);
    if(!updated.rowCount)return loadMaterial(c,id,u);
    if(changed)await c.query('delete from material_progress where material_id=$1',[id]);
    m.source_hash=digest;m.fingerprint=file.fingerprint;m.duration=duration;m.needs_review=review;m.revision=updated.rows[0].revision;
   }
  }}finally{if(!owns)await file.handle.close();}
 }catch(e){if(e instanceof HttpError&&[404,503].includes(e.status))available=false;else throw e;}
 const chapters=(await c.query('select seconds,title from material_chapter where material_id=$1 order by seconds,ordinal',[id])).rows;
 const progress=(await c.query('select position from material_progress where material_id=$1 and user_id=$2 and revision=$3',[id,u.id,m.revision])).rows[0];
 return{id,fileName:n.name,kind,mime:fileMime(n),size:Number(n.size),title:m.title||n.name,description:m.description,coverId:m.cover_id,duration:m.duration,published:await folderPublished(c,n),needsReview:m.needs_review,available,checking:pending,revision:m.revision,position:progress?.position??0,updatedAt:m.updated_at.toISOString(),chapters};
}
export async function saveFileCard(c:PoolClient,u:User,id:string,input:unknown){
 const value=materialInput.parse(input),n=await node(c,id);await access(c,n.space_id,n.id,u,true);
 const m=await ensureCard(c,n),kind=fileKind(n);
 if(!['video','audio'].includes(kind)&&value.chapters.length)throw new HttpError(400,'Тайм-коды доступны только для видео и аудио');
 if(value.chapters.some(ch=>m.duration<=0||ch.seconds>=m.duration))throw new HttpError(400,'Дождитесь проверки записи и укажите время в пределах её длительности');
 if(new Set(value.chapters.map(ch=>ch.seconds)).size!==value.chapters.length)throw new HttpError(400,'Тайм-коды не должны повторяться');
 if(value.coverId){const cover=await node(c,value.coverId);await access(c,cover.space_id,cover.id,u);if(cover.directory||cover.state!=='ready'||!['image/jpeg','image/png','image/webp'].includes(fileMime(cover)))throw new HttpError(400,'Выберите изображение PNG, JPEG или WebP');}
 if(value.reviewed&&(!m.source_hash||!m.fingerprint))throw new HttpError(409,'Сначала дождитесь проверки файла');
 await c.query('update material set title=$2,description=$3,cover_id=$4,needs_review=case when $5 then false else needs_review end,updated_at=now() where id=$1',[id,value.title,value.description,value.coverId,value.reviewed]);
 await c.query('delete from material_chapter where material_id=$1',[id]);for(const[index,ch]of [...value.chapters].sort((a,b)=>a.seconds-b.seconds).entries())await c.query('insert into material_chapter(material_id,ordinal,seconds,title) values($1,$2,$3,$4)',[id,index,ch.seconds,ch.title]);
 return{id};
}
