import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { Transform } from "node:stream";
import { v7 } from "uuid";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { attachmentLimits, attachmentName, mentionsSchema } from "@beacon/shared";
import { actor, checkOrigin, HttpError } from "../../lib/http";
import { member, rows, send } from "../../modules/chat/service";
import { storage } from "../../modules/media/storage";
const metadata = z.object({ chatId:z.uuid(), clientMessageId:z.uuid(), kind:z.enum(["file","video"]), text:z.string().max(10000).default(""), replyToId:z.uuid().optional(), mentions:mentionsSchema.optional() });
// Detect only browser-playable container MIME; everything else is a download.
function containerMime(header:Buffer): "video/mp4" | "video/webm" | "application/octet-stream" {
  if(header.toString("ascii",4,8)==="ftyp")return "video/mp4";
  if(header.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))return "video/webm";
  return "application/octet-stream";
}
export async function attachmentRoutes(app:FastifyInstance) {
  // This parser is encapsulated: existing small Fetch controllers retain their byte parser.
  app.removeAllContentTypeParsers();
  await app.register(multipart,{limits:{files:1,fields:6,parts:7,fileSize:attachmentLimits.video,fieldSize:40000,fieldNameSize:60,headerPairs:50}});
  let active=0;
  const leases = new WeakSet<object>();
  const release=(request:object)=>{if(leases.delete(request))active--;};
  app.addHook("onResponse",async request=>release(request));
  app.addHook("onRequestAbort",async request=>release(request));
  app.post("/api/attachments",{
    onRequest:async(request,reply)=>{
      try {
        checkOrigin(new Request(process.env.APP_URL!,{method:"POST",headers:new Headers(Object.entries(request.headers).flatMap(([key,value])=>typeof value==="string"?[[key,value]]:[]))}));
        await actor(new Headers({cookie:request.headers.cookie??""}));
        if(active>=2)throw new HttpError(429,"Сейчас загружаются другие файлы. Попробуйте чуть позже");
        active++;leases.add(request);
      }catch(error){reply.code(error instanceof HttpError?error.status:401).send({error:error instanceof HttpError?error.message:"Войдите в приложение"});}
    },
  },async(request,reply)=>{
    let saved:string|undefined;
    const timeout=setTimeout(()=>request.raw.destroy(new Error("Upload timeout")),20*60*1000);
    try {
      const user=await actor(new Headers({cookie:request.headers.cookie??""}));
      const fields:Record<string,string>={};let uploaded:{id:string;name:string;size:number;mime:"video/mp4"|"video/webm"|"application/octet-stream"}|undefined;
      let input:z.infer<typeof metadata>|undefined;
      for await(const part of request.parts()){
        if(part.type==="field"){
          if(part.valueTruncated || typeof part.value!=="string" || fields[part.fieldname]!==undefined)throw new HttpError(400,"Проверьте данные файла");
          fields[part.fieldname]=part.value;continue;
        }
        if(part.fieldname!=="file"||uploaded)throw new HttpError(400,"Отправляйте один файл за раз");
        // Metadata must precede the stream so authorization and limits are known before disk I/O.
        input=metadata.parse({...fields,mentions:JSON.parse(fields.mentions??"[]")});
        await member(input.chatId,user);
        const [old]=await rows(sql`select id,chat_id from message where author_id=${user.id} and client_message_id=${input.clientMessageId}`);
        if(old){part.file.resume();if(old.chat_id!==input.chatId)throw new HttpError(409,"Повторный идентификатор сообщения");return reply.send({id:old.id});}
        const limit=attachmentLimits[input.kind],id=v7();let size=0,header=Buffer.alloc(0);
        const bounded=new Transform({transform(chunk:Buffer,_encoding,callback){
          size+=chunk.length;
          if(size>limit){callback(new HttpError(413,`Максимальный размер ${input!.kind==="video"?"видео — 500":"файла — 100"} МБ`));return;}
          if(header.length<32)header=Buffer.concat([header,chunk.subarray(0,32-header.length)]);
          callback(null,chunk);
        }});
        saved=id;
        // pipeline propagates socket aborts and bounds memory through backpressure.
        const { pipeline }=await import("node:stream/promises");
        await pipeline(part.file,bounded,async source=>storage.saveStream(id,source));
        if(part.file.truncated)throw new HttpError(413,"Файл превышает допустимый размер");
        if(!size)throw new HttpError(400,"Файл пустой");
        uploaded={id,name:attachmentName(part.filename),size,mime:input.kind==="video"?containerMime(header):"application/octet-stream"};
      }
      if(!input||!uploaded)throw new HttpError(400,"Выберите файл");
      const result=await send(user,input.chatId,{...input,attachment:{...uploaded,kind:input.kind}});
      saved=undefined;
      if(!("attachmentId" in result))await storage.remove(uploaded.id).catch(()=>{});
      return reply.send(result);
    }catch(error){
      if(saved)await storage.remove(saved).catch(()=>{});
      const status=error instanceof HttpError?error.status:error instanceof z.ZodError||error instanceof SyntaxError?400:(error as {statusCode?:number}).statusCode??500;
      return reply.code(status).send({error:error instanceof HttpError?error.message:status===413?"Файл превышает допустимый размер":status===400?"Проверьте данные файла":"Не удалось отправить файл"});
    }finally{clearTimeout(timeout);release(request);}
  });
}
