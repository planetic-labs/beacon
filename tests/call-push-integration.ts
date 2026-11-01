import assert from 'node:assert/strict';
import {randomBytes,createECDH} from 'node:crypto';
import webpush from 'web-push';
import {v7} from 'uuid';
import {pool} from '../apps/api/src/db';
import {auth} from '../apps/api/src/modules/auth/config';
import {startCall,callAction,callState} from '../apps/api/src/modules/calls/service';
import {deliverCallPushBatch,callNotification} from '../apps/api/src/modules/push/calls';
if(process.env.APP_ENV!=='test')throw new Error('Disposable test environment required');
const vapid=webpush.generateVAPIDKeys();Object.assign(process.env,{VAPID_PUBLIC_KEY:vapid.publicKey,VAPID_PRIVATE_KEY:vapid.privateKey,LIVEKIT_URL:'wss://calls.example.com',LIVEKIT_INTERNAL_URL:'http://127.0.0.1:1',LIVEKIT_API_KEY:'test-key',LIVEKIT_API_SECRET:'test-only-call-push-secret'});
const a={id:v7(),role:'user'},b={id:v7(),role:'user'},chat=v7(),callerClient=v7(),answerClient=v7(),secondClient=v7();
const ctx=await auth.$context;
try{
 for(const u of [a,b])await pool.query('insert into "user"(id,name,first_name,last_name,email,email_verified,role) values($1,$2,$3,$4,$5,true,$6)',[u.id,'Тест Участник','Тест','Участник',`${u.id}@example.com`,u.role]);
 await pool.query('insert into chat(id,kind,owner_id,direct_key) values($1,$2,$3,$4)',[chat,'direct',a.id,[a.id,b.id].sort().join(':')]);
 for(const u of [a,b])await pool.query('insert into chat_member(chat_id,user_id) values($1,$2)',[chat,u.id]);
 const devices=[];
 for(const u of [b,b,a]){
  const session=await ctx.internalAdapter.createSession(u.id);assert.ok(session);
  const ecdh=createECDH('prime256v1');ecdh.generateKeys();
  const result=await pool.query('insert into push_subscription(user_id,session_id,endpoint,p256dh,auth) values($1,$2,$3,$4,$5) returning id',[u.id,session.id,`https://fcm.googleapis.com/test-${v7()}`,ecdh.getPublicKey().toString('base64url'),randomBytes(16).toString('base64url')]);
  devices.push({id:result.rows[0].id,sessionId:session.id});
 }
 const sent:{data:any;options:any}[]=[];
 const transport=async(_subscription:unknown,payload:string,options:any)=>{sent.push({data:JSON.parse(payload),options});};
 const c=await startCall(a,chat,'audio',callerClient);
 assert.equal((await callState(a,v7())).call,null,'caller second window stays quiet');
 assert.equal((await callState(b,answerClient)).call?.id,c.id);assert.equal((await callState(b,secondClient)).call?.id,c.id);
 await deliverCallPushBatch(transport);assert.equal(sent.length,2,'only callee devices receive invites');
 for(const push of sent){assert.equal(push.data.type,'call');assert.equal(push.data.action,'invite');assert.equal(push.options.urgency,'high');assert.equal(push.options.TTL,60);assert.equal(push.data.callerName,undefined);}
 assert.equal((await callNotification(devices[0].id,c.id,b.id,devices[0].sessionId)).active,true);
 assert.equal(await callNotification(devices[0].id,c.id,a.id,devices[0].sessionId),null);assert.equal(await callNotification(devices[0].id,c.id,b.id,v7()),null);
 const accepted=await Promise.allSettled([callAction(b,c.id,'accept',answerClient),callAction(b,c.id,'accept',secondClient)]);
 assert.equal(accepted.filter(r=>r.status==='fulfilled').length,1,'first answer wins atomically');
 const winner=accepted[0].status==='fulfilled'?answerClient:secondClient,loser=winner===answerClient?secondClient:answerClient;
 assert.equal((await callState(b,loser)).call,null);await assert.rejects(callAction(b,c.id,'join',loser));await assert.rejects(callAction(b,c.id,'end',loser));
 await deliverCallPushBatch(transport);assert.equal(sent.filter(p=>p.data.action==='state').length,2);assert.equal((await callNotification(devices[0].id,c.id,b.id,devices[0].sessionId)).active,false);
 await callAction(b,c.id,'end',winner);
 const old=await startCall(a,chat,'video',callerClient);await pool.query('update "call" set created_at=now()-interval \'2 minutes\' where id=$1',[old.id]);
 const before=sent.length;await deliverCallPushBatch(transport);assert.equal(sent.length,before,'late invites are skipped');await callState(a,callerClient);
 await pool.query('insert into chat_notification_preference(user_id,chat_id,muted) values($1,$2,true)',[b.id,chat]);
 const muted=await startCall(a,chat,'audio',callerClient);await deliverCallPushBatch(transport);assert.equal(sent.filter(p=>p.data.callId===muted.id&&p.data.action==='invite').length,0);
 console.log('PASS multi-device call ownership, concurrent answer, high-priority private push, cancellation, expiry, account/session isolation and mute');
}finally{await pool.end();}
