import type {TranscriptionProvider,TranscriptionInput,TranscriptionResult} from './provider';
export class TranscriptionError extends Error {
 constructor(public status:number,message:string){super(message);}
}
export class GroqTranscriptionProvider implements TranscriptionProvider {
 constructor(private key:string,private model='whisper-large-v3-turbo',private request:typeof fetch=fetch){}
 async transcribe(input:TranscriptionInput,{signal}:{signal:AbortSignal}):Promise<TranscriptionResult>{
  const form=new FormData();form.set('model',this.model);form.set('response_format','json');
  form.set('file',new Blob([new Uint8Array(input.audio)],{type:input.mimeType}),'recording.m4a');if(input.language)form.set('language',input.language);
  let response:Response;
  try{response=await this.request('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${this.key}`},body:form,signal});}
  catch{throw new TranscriptionError(504,'Сервис расшифровки не ответил. Попробуйте ещё раз');}
  // Never expose provider response bodies, credentials or recording content.
  if(!response.ok)throw new TranscriptionError(response.status===429?429:502,response.status===429?'Лимит расшифровок временно исчерпан. Повторите позже':'Сервис расшифровки временно недоступен');
  let result:unknown;try{result=await response.json();}catch{throw new TranscriptionError(502,'Некорректный ответ сервиса расшифровки');}
  const text=(result as {text?:unknown})?.text;
  if(typeof text!=='string'||text.length>10000)throw new TranscriptionError(502,'Некорректный ответ сервиса расшифровки');
  if(!text.trim())throw new TranscriptionError(422,'Не удалось распознать речь. Попробуйте записать ещё раз');
  return {text:text.trim()};
 }
}
export function createTranscriptionProvider():TranscriptionProvider{
 if(process.env.TRANSCRIPTION_PROVIDER!=='groq'||!process.env.GROQ_API_KEY)throw new TranscriptionError(503,'Расшифровка пока не настроена');
 return new GroqTranscriptionProvider(process.env.GROQ_API_KEY,process.env.GROQ_TRANSCRIPTION_MODEL||'whisper-large-v3-turbo');
}
