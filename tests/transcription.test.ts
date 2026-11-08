import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GroqTranscriptionProvider,TranscriptionError,createTranscriptionProvider} from '../apps/api/src/modules/transcription/groq';
const input={audio:new Uint8Array([1,2,3]),mimeType:'audio/mp4',language:'ru'};
test('Groq adapter sends audio to the fixed server endpoint and returns provider-independent text',async()=>{
 const provider=new GroqTranscriptionProvider('test-only-key',undefined,async(url,options)=>{
  assert.equal(url,'https://api.groq.com/openai/v1/audio/transcriptions');assert.equal(new Headers(options?.headers).get('Authorization'),'Bearer test-only-key');
  const form=options?.body as FormData;assert.equal(form.get('model'),'whisper-large-v3-turbo');assert.equal(form.get('language'),'ru');assert.equal(form.get('response_format'),'json');assert.ok(form.get('file') instanceof File);assert.equal((form.get('file') as File).size,3);assert.ok(options?.signal instanceof AbortSignal);
  return Response.json({text:'  Проверка записи  '});
 });
 assert.deepEqual(await provider.transcribe(input,{signal:new AbortController().signal}),{text:'Проверка записи'});
});
test('provider errors never leak upstream response content and preserve rate limit status',async()=>{
 for(const status of [401,429,500]){
  const provider=new GroqTranscriptionProvider('test-only-key',undefined,async()=>new Response('private upstream details',{status}));
  await assert.rejects(provider.transcribe(input,{signal:new AbortController().signal}),error=>error instanceof TranscriptionError&&error.status===(status===429?429:502)&&!error.message.includes('private'));
 }
});
test('empty, malformed, overlong and aborted transcription responses are handled',async()=>{
 for(const body of [{text:''},{text:' '},{text:12},{text:'a'.repeat(10001)}]){
  const provider=new GroqTranscriptionProvider('test-only-key',undefined,async()=>Response.json(body));await assert.rejects(provider.transcribe(input,{signal:new AbortController().signal}),TranscriptionError);
 }
 const controller=new AbortController();controller.abort();
 const provider=new GroqTranscriptionProvider('test-only-key',undefined,async(_url,options)=>{options?.signal?.throwIfAborted();throw new Error('network');});
 await assert.rejects(provider.transcribe(input,{signal:controller.signal}),error=>error instanceof TranscriptionError&&error.status===504);
});
test('missing configuration disables transcription without exposing key values',()=>{
 const before=process.env.GROQ_API_KEY;try{delete process.env.GROQ_API_KEY;assert.throws(createTranscriptionProvider,error=>error instanceof TranscriptionError&&error.status===503);}finally{if(before===undefined)delete process.env.GROQ_API_KEY;else process.env.GROQ_API_KEY=before;}
});
