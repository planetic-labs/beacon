import webpush from 'web-push';
import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {db} from '../../db';
import {rows,type Tx} from '../chat/service';
import {pushConfiguration} from './config';
import type {PushTransport} from './worker';
export async function enqueueCallPush(tx:Tx,callId:string,kind:'invite'|'state'){
 if(!pushConfiguration())return;
 await tx.execute(sql`insert into call_push_delivery(call_id,subscription_id,kind)
 select c.id,ps.id,${kind} from "call" c join call_participant p on p.call_id=c.id and p.user_id<>c.caller_id
 join push_subscription ps on ps.user_id=p.user_id where c.id=${callId} on conflict do nothing`);
}
export async function callNotification(subscriptionId:string,callId:string,userId?:string,sessionId?:string){
 const [row]=await rows(sql`select ps.id as "subscriptionId",ps.user_id as "userId",ps.endpoint,ps.p256dh,ps.auth,c.id as "callId",c.chat_id as "chatId",c.mode,
 (c.status='ringing' and c.created_at>now()-interval '60 seconds' and p.client_id is null and coalesce(np.enabled,true) and not coalesce(cp.muted,false)) as active,
 coalesce(np.show_preview,false) as "showPreview",a.name as "callerName"
 from push_subscription ps join session s on s.id=ps.session_id and s.expires_at>now()
 join "user" u on u.id=ps.user_id and not u.banned
 join call_participant p on p.user_id=ps.user_id and p.call_id=${callId}
 join "call" c on c.id=p.call_id and c.caller_id<>ps.user_id
 join "user" a on a.id=c.caller_id and not a.banned
 join chat_member m on m.chat_id=c.chat_id and m.user_id=ps.user_id
 join chat_member caller_member on caller_member.chat_id=c.chat_id and caller_member.user_id=c.caller_id
 left join notification_preference np on np.user_id=ps.user_id
 left join chat_notification_preference cp on cp.user_id=ps.user_id and cp.chat_id=c.chat_id
 where ps.id=${subscriptionId} ${userId?sql`and ps.user_id=${userId}`:sql``} ${sessionId?sql`and ps.session_id=${sessionId}`:sql``}`);
 return row??null;
}
export async function deliverCallPushBatch(transport:PushTransport=webpush.sendNotification){
 const config=pushConfiguration();if(!config)return;
 const batch=await rows(sql`update call_push_delivery d set lease_until=now()+interval '15 seconds',attempts=d.attempts+1 from
 (select id from call_push_delivery where completed_at is null and next_attempt_at<=now() and (lease_until is null or lease_until<now()) order by next_attempt_at,id limit 10 for update skip locked) q where d.id=q.id returning d.*`);
 await Promise.all(batch.map(async job=>{try{
  const record=await callNotification(job.subscription_id,job.call_id);
  if(!record||(job.kind==='invite'&&!record.active)){
   await db.execute(sql`update call_push_delivery set completed_at=now(),outcome='skipped',lease_until=null where id=${job.id}`);return;
  }
  await transport({endpoint:record.endpoint,keys:{p256dh:record.p256dh,auth:record.auth}},JSON.stringify({type:'call',action:job.kind,subscriptionId:record.subscriptionId,userId:record.userId,callId:record.callId,chatId:record.chatId}),{vapidDetails:config,TTL:60,urgency:'high',timeout:10000,topic:createHash('sha256').update(record.callId).digest('base64url').slice(0,32)});
  await db.execute(sql`update call_push_delivery set completed_at=now(),outcome='sent',lease_until=null where id=${job.id}`);
 }catch(error){
  const status=(error as {statusCode?:number}).statusCode;
  if(status===404||status===410){await db.execute(sql`delete from push_subscription where id=${job.subscription_id}`);return;}
  const expired=job.attempts>=4||Date.now()-new Date(job.created_at).getTime()>60000;
  await db.execute(sql`update call_push_delivery set lease_until=null,next_attempt_at=now()+interval '3 seconds',completed_at=${expired?new Date():null},outcome=${expired?'failed':'retry'} where id=${job.id}`);
 }}));
}
