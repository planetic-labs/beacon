import {actor,checkOrigin,HttpError} from '@api/lib/http';
import {member} from '@api/modules/chat/service';
import {prepareRecording} from '@api/modules/media/recording';
import {createTranscriptionProvider,TranscriptionError} from '@api/modules/transcription/groq';
import {recordingLimits} from '@beacon/shared';
import {z} from 'zod';
import type {TranscriptionProvider} from '@api/modules/transcription/provider';
type Dependencies={actor:typeof actor;member:typeof member;prepare:typeof prepareRecording;provider:()=>TranscriptionProvider};
export function createTranscriptionHandler(dependencies:Dependencies={actor,member,prepare:prepareRecording,provider:createTranscriptionProvider}){
 const active=new Set<string>(),recent=new Map<string,number[]>();
 return async function handle(request:Request){
 let owner:string|undefined;
 try{
  checkOrigin(request);const user=await dependencies.actor(request.headers);
  const provider=dependencies.provider();
  if(active.has(user.id)||active.size>=2)throw new HttpError(429,'Уже выполняется расшифровка. Повторите чуть позже');
  const now=Date.now();for(const [id,times] of recent)if(!times.some(time=>now-time<60000))recent.delete(id);
  const times=(recent.get(user.id)??[]).filter(time=>now-time<60000);
  if(times.length>=6)throw new HttpError(429,'Слишком много расшифровок. Повторите через минуту');
  active.add(user.id);owner=user.id;recent.set(user.id,[...times,now]);
  const form=await request.formData(),chatId=z.uuid().parse(form.get('chatId'));await dependencies.member(chatId,user);
  const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>recordingLimits.audio.bytes)throw new HttpError(400,'Запись слишком большая или пустая');
  const audio=await dependencies.prepare(new Uint8Array(await file.arrayBuffer()),'audio');
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(90000)]);
  const result=await provider.transcribe({audio:audio.bytes,mimeType:audio.mime},{signal});
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){const known=error instanceof HttpError||error instanceof TranscriptionError;return Response.json({error:known?error.message:error instanceof z.ZodError?'Проверьте данные записи':'Не удалось расшифровать запись'},{status:known?error.status:error instanceof z.ZodError?400:500});}
 finally{if(owner)active.delete(owner);}
}

}
export const POST=createTranscriptionHandler();
