import {enqueueCallPush} from '../push/calls';
import { sql } from 'drizzle-orm';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { db } from '../../db';
import { HttpError } from '../../lib/http';
import { rows, member, writable, type Actor, type Tx } from '../chat/service';

export function callConfig() {
 const {LIVEKIT_URL:url,LIVEKIT_INTERNAL_URL:internal,LIVEKIT_API_KEY:key,LIVEKIT_API_SECRET:secret}=process.env;
 if(!url||!internal||!key||!secret)return null;
 return {url,internal,key,secret,prefix:process.env.LIVEKIT_ROOM_PREFIX||'beacon'};
}
function provider(){const c=callConfig();if(!c)throw new HttpError(503,'Звонки ещё не настроены');return {...c,client:new RoomServiceClient(c.internal,c.key,c.secret,{requestTimeout:5})};}
function roomName(id:string){return `${callConfig()?.prefix||'beacon'}-${id}`;}
async function lock(tx:Tx){await tx.execute(sql`select pg_advisory_xact_lock(hashtext('beacon-call-lifecycle'))`);}
async function changed(tx:Tx,id:string){
 const users=await rows(sql`select user_id from call_participant where call_id=${id}`,tx);
 await tx.execute(sql`insert into outbox(kind,payload) values('calls.changed',${JSON.stringify({userIds:users.map(u=>u.user_id)})}::jsonb)`);
}
async function finish(tx:Tx,id:string,reason:string){
 await tx.execute(sql`update "call" set status='ended',reason=${reason},ended_at=now() where id=${id} and status<>'ended'`);
 await tx.execute(sql`insert into outbox(kind,payload) values('call.cleanup',${JSON.stringify({callId:id})}::jsonb)`);
 await changed(tx,id);await enqueueCallPush(tx,id,'state');
}
async function expire(tx:Tx){
 const stale=await rows(sql`select c.id from "call" c where c.status<>'ended' and (
  exists(select 1 from call_participant p where p.call_id=c.id and p.user_id=c.caller_id and p.client_id is null) or
  (c.status='ringing' and c.created_at<now()-interval '60 seconds') or
  (c.status='active' and exists(select 1 from call_participant p where p.call_id=c.id and p.heartbeat_at<now()-interval '45 seconds')) or
  exists(select 1 from call_participant p join "user" u on u.id=p.user_id where p.call_id=c.id and (u.banned or not exists(select 1 from chat_member m where m.chat_id=c.chat_id and m.user_id=p.user_id)))
 )`,tx);
 for(const c of stale)await finish(tx,c.id,'timeout');
}
export async function callState(u:Actor,clientId:string){
 return db.transaction(async tx=>{
  await writable(tx,u);await lock(tx);await expire(tx);
  const [active]=await rows(sql`select c.id,c.chat_id as "chatId",c.caller_id as "callerId",c.mode,c.status,c.created_at as "createdAt",c.accepted_at as "acceptedAt",
   (select json_agg(json_build_object('id',p.user_id,'name',a.name,'image',a.image)) from call_participant p join "user" a on a.id=p.user_id where p.call_id=c.id) as participants
   from "call" c join call_participant p on p.call_id=c.id where p.user_id=${u.id} and c.status<>'ended' and (p.client_id=${clientId}::uuid or (c.status='ringing' and c.caller_id<>${u.id} and p.client_id is null)) order by c.created_at desc limit 1`,tx);
  return {configured:!!callConfig(),call:active??null};
 });
}
export async function startCall(u:Actor,chatId:string,mode:'audio'|'video',clientId:string){
 provider();return db.transaction(async tx=>{
  await writable(tx,u);await lock(tx);await expire(tx);
  const chat=await member(chatId,u,tx,true);
  if(chat.kind!=='direct')throw new HttpError(400,'Пока доступны только личные звонки');
  const people=await rows(sql`select m.user_id,u.banned from chat_member m join "user" u on u.id=m.user_id where m.chat_id=${chatId}`,tx);
  if(people.length!==2||people.some(p=>p.banned))throw new HttpError(409,'Собеседник недоступен');
  const busy=await rows(sql`select c.id from "call" c join call_participant p on p.call_id=c.id where c.status<>'ended' and p.user_id in (${sql.join(people.map(p=>sql`${p.user_id}::uuid`),sql`,`)}) limit 1`,tx);
  if(busy.length)throw new HttpError(409,'Один из участников уже участвует в звонке');
  const [call]=await rows(sql`insert into "call"(chat_id,caller_id,mode) values(${chatId},${u.id},${mode}) returning id`,tx);
  for(const p of people)await tx.execute(sql`insert into call_participant(call_id,user_id,client_id) values(${call.id},${p.user_id},${p.user_id===u.id?clientId:null}::uuid)`);
  await changed(tx,call.id);await enqueueCallPush(tx,call.id,'invite');return {id:call.id};
 });
}
export async function callAction(u:Actor,id:string,action:string,clientId:string){
 return db.transaction(async tx=>{
  await writable(tx,u);await lock(tx);await expire(tx);
  const [c]=await rows(sql`select c.*,p.client_id from "call" c join call_participant p on p.call_id=c.id where c.id=${id} and p.user_id=${u.id}`,tx);
  if(!c)throw new HttpError(404,'Звонок не найден');await member(c.chat_id,u,tx);
  const invited=c.status==='ringing'&&c.caller_id!==u.id&&c.client_id===null;
  if(action!=='accept'&&c.client_id!==clientId&&!((action==='end'||action==='decline')&&invited))throw new HttpError(403,'Звонок открыт на другом устройстве');
  if(action==='end'||action==='decline'){
   if(c.status!=='ended')await finish(tx,id,action==='decline'?'declined':'hangup');return {ok:true};
  }
  if(c.status==='ended')throw new HttpError(409,'Звонок уже завершён');
  if(action==='accept'){
   if(c.caller_id===u.id)throw new HttpError(403,'Ответить может только собеседник');
   if(c.status!=='ringing'&&c.client_id!==clientId)throw new HttpError(409,'Звонок уже принят');
   if(c.status==='ringing'){
    await tx.execute(sql`update call_participant set client_id=${clientId} where call_id=${id} and user_id=${u.id}`);
    await tx.execute(sql`update "call" set status='active',accepted_at=now() where id=${id}`);
    await tx.execute(sql`update call_participant set heartbeat_at=now() where call_id=${id}`);await changed(tx,id);await enqueueCallPush(tx,id,'state');
   }return {ok:true};
  }
  if(action==='heartbeat'){
   await tx.execute(sql`update call_participant set heartbeat_at=now() where call_id=${id} and user_id=${u.id}`);return {ok:true};
  }
  if(action!=='join'||c.status!=='active')throw new HttpError(409,'Дождитесь ответа на звонок');
  const config=provider(),name=roomName(id);
  // Explicit room creation plus auto_create:false prevents an old token recreating an ended call.
  await config.client.createRoom({name,maxParticipants:2,emptyTimeout:60,departureTimeout:15});
  const token=new AccessToken(config.key,config.secret,{identity:u.id,ttl:60});
  token.addGrant({room:name,roomJoin:true,canPublish:true,canSubscribe:true,canPublishData:false,canPublishSources:c.mode==='audio'?[TrackSource.MICROPHONE]:[TrackSource.MICROPHONE,TrackSource.CAMERA]});
  return {url:config.url,token:await token.toJwt()};
 });
}
export async function maintainCalls(){
 if(!callConfig())return;
 await db.transaction(async tx=>{await lock(tx);await expire(tx);});
 await db.transaction(async tx=>{
  const batch=await rows(sql`select id,payload from outbox where kind='call.cleanup' and processed_at is null order by created_at limit 10 for update skip locked`,tx);
  const config=provider();for(const item of batch){
   const name=roomName(item.payload.callId);
   const rooms=await config.client.listRooms([name]);if(rooms.length)await config.client.deleteRoom(name);
   await tx.execute(sql`update outbox set processed_at=now() where id=${item.id}`);
  }
 });
}
