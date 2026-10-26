import { useEffect, useRef, useState, type RefObject } from "react";
import type { Socket } from "socket.io-client";
import { fileSize, type AttachmentCategory, type AttachmentPage } from "@beacon/shared";
import { api, Dialog } from "./ui";
import { CirclePlayer } from "./message-types";
import { Icon } from "./icon";
import type { PhotoTarget } from "./photo-viewer";
const tabs:[AttachmentCategory,string][]=[["photo","Фото"],["video","Видео"],["file","Файлы"],["links","Ссылки"],["audio","Аудио"]];
export function ChatAttachments({chatId,name,socket,close,photo,jump}:{chatId:string;name:string;socket:RefObject<Socket|null>;close:()=>void;photo:(target:PhotoTarget)=>void;jump:(id:string)=>void}) {
 const [kind,setKind]=useState<AttachmentCategory>("photo"),[page,setPage]=useState<AttachmentPage>({items:[]}),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const generation=useRef(0);
 useEffect(()=>{
  const version=++generation.current;let request=0;
  const refresh=async()=>{const current=++request;setBusy(true);setError("");try{const result=await api<AttachmentPage>(`chats/${chatId}/attachments?kind=${kind}`);if(generation.current===version&&current===request&&Array.isArray(result.items))setPage(result);}catch(e){if(generation.current===version){setPage({items:[]});setError(e instanceof Error?e.message:String(e));}}finally{if(generation.current===version&&current===request)setBusy(false);}};
  setPage({items:[]});void refresh();const s=socket.current;const changed=({chatId:id}:{chatId:string})=>{if(id===chatId)void refresh();};s?.on("chat.changed",changed);s?.on("connect",refresh);
  return()=>{generation.current++;s?.off("chat.changed",changed);s?.off("connect",refresh);};
 },[chatId,kind]);
 async function more(){if(!page.next||busy)return;setBusy(true);setError("");const version=generation.current;try{const result=await api<AttachmentPage>(`chats/${chatId}/attachments?kind=${kind}&beforeId=${page.next.id}&beforeAt=${encodeURIComponent(page.next.at)}`);if(generation.current===version)setPage(old=>({...result,items:[...old.items,...result.items]}));}catch(e){if(generation.current===version)setError(e instanceof Error?e.message:String(e));}finally{if(generation.current===version)setBusy(false);}}
 return <Dialog title={`Вложения · ${name}`} className="attachments-dialog" close={close}><div className="attachment-tabs" role="tablist" aria-label="Тип вложений">{tabs.map(([id,label])=><button type="button" role="tab" aria-selected={kind===id} key={id} onClick={()=>setKind(id)}>{label}</button>)}</div><div className="attachment-results" role="tabpanel" aria-label={tabs.find(t=>t[0]===kind)?.[1]} aria-busy={busy}>
  {error&&<p role="alert">{error}</p>}{!busy&&!error&&!page.items.length&&<p className="search-hint">Пока нет вложений этого типа</p>}
  {page.items.map(item=><article className="attachment-entry" key={item.messageId}><div className="attachment-entry-heading"><span>{item.authorName} · {new Date(item.createdAt).toLocaleDateString("ru")}</span><button className="text-button" onClick={()=>{close();jump(item.messageId);}}>К сообщению</button></div>
   {kind==="photo"?<div className="attachment-photo-grid">{item.files.map((file,index)=><button key={file.id} type="button" aria-label={`Открыть фото ${index+1}: ${item.authorName}`} onClick={()=>photo({chatId,messageId:item.messageId,index})}><img src={`/media/${file.id}?thumbnail=1`} alt={`Фото ${index+1}`} loading="lazy"/></button>)}</div>
    :kind==="links"?<div className="attachment-links">{item.links.map(url=><a key={url} href={url} target="_blank" rel="noopener noreferrer">{url}</a>)}</div>
    :item.files.map(file=><div key={file.id} className="attachment-file-entry">{kind==="audio"&&<audio controls preload="none" src={`/media/${file.id}`} aria-label="Голосовое сообщение"/>}{kind==="video"&&(item.type==="circle"?<CirclePlayer src={`/media/${file.id}`} duration={item.duration}/>:file.mime.startsWith("video/")?<video controls playsInline preload="none" src={`/media/${file.id}`} aria-label={file.name??"Видео"}/>:null)}<a href={`/media/${file.id}?download=1`} download><Icon name="download"/><span>{file.name??(kind==="audio"?"Голосовое сообщение":item.type==="circle"?"Видеокружок":"Видео")} · {fileSize(file.size)}</span></a></div>)}
   {item.text&&<p className="attachment-caption">{item.text}</p>}
  </article>)}{busy&&<p role="status">Загружаем…</p>}{page.next&&<button className="text-button" disabled={busy} onClick={()=>void more()}>Показать ещё</button>}
 </div></Dialog>;
}
