import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.APP_URL='https://example.com';process.env.APP_ENV='test';process.env.BETTER_AUTH_SECRET='test-only-transcription-secret-at-least-thirty-two-characters';
const {createTranscriptionHandler}=await import('../apps/api/src/http/controllers/transcription');
const {HttpError}=await import('../apps/api/src/lib/http');
const id='019a0000-0000-7000-8000-000000000001';
function request(file=true,origin='https://example.com') {const form=new FormData();form.set('chatId',id);if(file)form.set('file',new Blob(['recording'],{type:'audio/webm'}),'recording.webm');return new Request('https://example.com/api/transcriptions',{method:'POST',headers:{origin},body:form});}
function setup(){let recognized=0;const dependencies:NonNullable<Parameters<typeof createTranscriptionHandler>[0]>={actor:async()=>({id,role:'user'} as any),member:async()=>({} as any),prepare:async()=>({bytes:Buffer.from('normalized'),mime:'audio/mp4',duration:1}),provider:()=>({transcribe:async()=>{recognized++;return {text:'Распознанная речь'};}})};return {dependencies,count:()=>recognized};}
test('transcription validates origin, identity and membership before recognizing audio',async()=>{
 const fixture=setup(),handler=createTranscriptionHandler(fixture.dependencies);
 assert.equal((await handler(request(true,'https://other.example.com'))).status,403);assert.equal(fixture.count(),0);
 fixture.dependencies.actor=async()=>{throw new HttpError(401,'Войдите');};assert.equal((await handler(request())).status,401);
 fixture.dependencies.actor=async()=>({id,role:'user'} as any);fixture.dependencies.member=async()=>{throw new HttpError(403,'Нет доступа');};assert.equal((await handler(request())).status,403);assert.equal(fixture.count(),0);
});
test('valid input becomes text without a chat message, empty input fails and rate limits apply',async()=>{
 const fixture=setup(),handler=createTranscriptionHandler(fixture.dependencies);
 assert.equal((await handler(request(false))).status,400);
 for(let i=0;i<5;i++){const response=await handler(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),{text:'Распознанная речь'});}
 assert.equal((await handler(request())).status,429);assert.equal(fixture.count(),5);
});
test('one active request per user and cancellation reach the recognition provider',async()=>{
 const fixture=setup();let seen:AbortSignal|undefined;let release:()=>void=()=>{};let started:()=>void=()=>{};const waiting=new Promise<void>(resolve=>{started=resolve;});
 fixture.dependencies.provider=()=>({transcribe:async(_input,{signal})=>{assert.ok(signal instanceof AbortSignal);seen=signal;started();await new Promise<void>(resolve=>{release=resolve;});return {text:'Готово'};}});
 const cancellation=new AbortController();const handler=createTranscriptionHandler(fixture.dependencies),pending=handler(new Request(request(),{signal:cancellation.signal}));await waiting;assert.equal((await handler(request())).status,429);cancellation.abort();assert.equal(seen?.aborted,true);release();assert.equal((await pending).status,200);
});
