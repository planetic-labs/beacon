// Disposable PostgreSQL and a synthetic LiveKit control API; never use dev accounts.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {v7} from 'uuid';
import {TokenVerifier} from '../apps/api/node_modules/livekit-server-sdk/dist/index.js';
import {pool} from '../apps/api/src/db';
import {startCall as rawStartCall,callAction as rawCallAction,callState as rawCallState,maintainCalls} from '../apps/api/src/modules/calls/service';
const clients=new Map<string,string>();
const device=(u:{id:string})=>{if(!clients.has(u.id))clients.set(u.id,v7());return clients.get(u.id)!;};
const startCall=(u:{id:string;role:string},chatId:string,mode:'audio'|'video')=>rawStartCall(u,chatId,mode,device(u));
const callState=(u:{id:string;role:string})=>rawCallState(u,device(u));
const callAction=(u:{id:string;role:string},id:string,action:string)=>rawCallAction(u,id,action,device(u));
if(process.env.APP_ENV!=='test')throw new Error('Disposable test environment required');
const rooms=new Map<string,unknown>();
const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body||'{}');res.setHeader('content-type','application/json');
 if(req.url?.endsWith('/CreateRoom')){rooms.set(data.name,{name:data.name,sid:'RM_test'});res.end(JSON.stringify(rooms.get(data.name)));}
 else if(req.url?.endsWith('/ListRooms'))res.end(JSON.stringify({rooms:[...rooms.values()]}));
 else if(req.url?.endsWith('/DeleteRoom')){rooms.delete(data.room);res.end('{}');}else{res.statusCode=404;res.end('{}');}
});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address() as {port:number};
Object.assign(process.env,{LIVEKIT_URL:'wss://calls.example.com',LIVEKIT_INTERNAL_URL:`http://127.0.0.1:${address.port}`,LIVEKIT_API_KEY:'test-key',LIVEKIT_API_SECRET:'test-only-livekit-secret-not-for-deployment',LIVEKIT_ROOM_PREFIX:'fixture'});
const people=[v7(),v7(),v7()];const [a,b,outsider]=people.map(id=>({id,role:'user'}));const direct=v7(),group=v7();
try{
 for(const id of people)await pool.query('insert into "user"(id,name,first_name,last_name,email,email_verified,role) values($1,$2,$3,$4,$5,true,$6)',[id,'Тест Участник','Тест','Участник',`${id}@example.com`,'user']);
 await pool.query('insert into chat(id,kind,direct_key,owner_id) values($1,$2,$3,$4)',[direct,'direct',[a.id,b.id].sort().join(':'),a.id]);
 await pool.query('insert into chat(id,kind,title,owner_id) values($1,$2,$3,$4)',[group,'group','Тестовая группа',a.id]);
 for(const chat of [direct,group])for(const id of [a.id,b.id])await pool.query('insert into chat_member(chat_id,user_id) values($1,$2)',[chat,id]);
 await assert.rejects(startCall(outsider,direct,'audio'));
 await assert.rejects(startCall(a,group,'audio'));
 const results=await Promise.allSettled([startCall(a,direct,'audio'),startCall(b,direct,'audio')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'overlapping calls serialize');
 const state=await callState(a),call=state.call!;assert.equal(call.participants.length,2);assert.equal((await callState(outsider)).call,null);
 const caller=call.callerId===a.id?a:b,callee=caller.id===a.id?b:a;
 await assert.rejects(callAction(outsider,call.id,'accept'));
 await assert.rejects(callAction(caller,call.id,'accept'));await assert.rejects(callAction(callee,call.id,'join'));
 const otherCaller=v7(),otherCallee=v7();
 assert.equal((await rawCallState(caller,otherCaller)).call,null);
 assert.equal((await rawCallState(callee,otherCallee)).call?.id,call.id);
 await assert.rejects(rawCallAction(caller,call.id,'end',otherCaller));
 await callAction(callee,call.id,'accept');await callAction(callee,call.id,'accept');
 assert.equal((await rawCallState(callee,otherCallee)).call,null);
 await assert.rejects(rawCallAction(callee,call.id,'join',otherCallee));
 await assert.rejects(rawCallAction(callee,call.id,'heartbeat',otherCallee));
 await assert.rejects(rawCallAction(callee,call.id,'accept',otherCallee));
 const joined=await callAction(caller,call.id,'join') as {token:string};
 const claims=await new TokenVerifier(process.env.LIVEKIT_API_KEY!,process.env.LIVEKIT_API_SECRET!).verify(joined.token);
 assert.equal(claims.sub,caller.id);assert.equal(claims.video?.room,`fixture-${call.id}`);assert.deepEqual(claims.video?.canPublishSources,['microphone']);
 await callAction(callee,call.id,'end');await assert.rejects(callAction(caller,call.id,'join'));await maintainCalls();assert.equal(rooms.size,0);assert.equal((await callState(a)).call,null);
 const next=await startCall(a,direct,'video');await callAction(b,next.id,'accept');
 await pool.query('update call_participant set heartbeat_at=now()-interval \'1 minute\' where call_id=$1',[next.id]);await maintainCalls();assert.equal((await callState(b)).call,null);
 const ringing=await startCall(a,direct,'audio');await pool.query('update "call" set created_at=now()-interval \'2 minutes\' where id=$1',[ringing.id]);assert.equal((await callState(b)).call,null);
 const blocked=await startCall(a,direct,'audio');await pool.query('update "user" set banned=true where id=$1',[b.id]);await maintainCalls();await assert.rejects(callAction(b,blocked.id,'accept'));assert.equal((await callState(a)).call,null);
 console.log('PASS call membership, personal-only creation, concurrent busy state, accept, scoped tokens, room cleanup, timeout and blocking');
}finally{await pool.end();await new Promise<void>(resolve=>server.close(()=>resolve()));}
