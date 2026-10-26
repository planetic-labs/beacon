import sharp from "sharp";
import { storage } from "./storage";
const cache=new Map<string,Buffer>(),pending=new Map<string,Promise<Buffer>>();
let bytes=0,active=0;
const waiting:(()=>void)[]=[];
async function acquire(){if(active<2){active++;return;}if(waiting.length>=64)throw new Error("Thumbnail queue full");await new Promise<void>(resolve=>waiting.push(resolve));}
function release(){const next=waiting.shift();if(next)next();else active--;}
// Small in-memory derivatives only. Every HTTP request authorizes access before this cache.
export async function thumbnail(id:string,key:string):Promise<Buffer>{
 const found=cache.get(id);if(found){cache.delete(id);cache.set(id,found);return found;}
 const existing=pending.get(id);if(existing)return existing;
 const work=(async()=>{
  await acquire();try{
   const result=await sharp(await storage.read(key),{limitInputPixels:24_000_000,animated:false,failOn:"error"}).rotate().resize(320,320,{fit:"inside",withoutEnlargement:true}).webp({quality:72}).timeout({seconds:5}).toBuffer();
   if(result.length<=8*1024*1024){cache.set(id,result);bytes+=result.length;while(bytes>8*1024*1024||cache.size>128){const oldest=cache.keys().next().value!;bytes-=cache.get(oldest)!.length;cache.delete(oldest);}}
   return result;
  }finally{release();}
 })();pending.set(id,work);try{return await work;}finally{pending.delete(id);}
}
