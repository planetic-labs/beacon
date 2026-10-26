import { useEffect, useRef, useState } from "react";
import { attachmentLimits, fileSize, type AttachmentKind } from "@beacon/shared";
import { v7 } from "uuid";
import { Dialog } from "./ui";
export function AttachmentUpload({file,kind,chatId,replyToId,close,notify,sent}:{file:File;kind:AttachmentKind;chatId:string;replyToId?:string;close:()=>void;notify:(error:unknown)=>void;sent:(chatId:string)=>Promise<void>}) {
  const [caption,setCaption]=useState(""),[uploading,setUploading]=useState(false),[progress,setProgress]=useState(0);
  const request=useRef<XMLHttpRequest|null>(null),clientId=useRef(v7()),live=useRef(true);
  useEffect(()=>()=>{live.current=false;request.current?.abort();},[]);
  useEffect(()=>{const guard=(e:Event)=>{if(uploading)e.preventDefault();};window.addEventListener("beacon:before-update",guard);return()=>window.removeEventListener("beacon:before-update",guard);},[uploading]);
  function cancel(){request.current?.abort();close();}
  async function upload(){
    if(uploading)return;
    if(!file.size||file.size>attachmentLimits[kind]){notify(new Error(`Допустимый размер: ${kind==="video"?"500":"100"} МБ`));return;}
    setUploading(true);setProgress(0);
    try {
      await new Promise<void>((resolve,reject)=>{
        const xhr=new XMLHttpRequest();request.current=xhr;xhr.open("POST","/api/attachments");xhr.timeout=20*60*1000;xhr.responseType="json";
        xhr.upload.onprogress=e=>{if(live.current&&e.lengthComputable)setProgress(Math.min(100,Math.round(e.loaded/e.total*100)));};
        xhr.onload=()=>{if(xhr.status===401)window.dispatchEvent(new Event("beacon:unauthorized"));if(xhr.status>=200&&xhr.status<300)resolve();else reject(new Error(xhr.response?.error??"Не удалось отправить файл"));};
        xhr.onerror=()=>reject(new Error("Нет связи. Попробуйте отправить файл ещё раз"));xhr.ontimeout=()=>reject(new Error("Время загрузки истекло. Попробуйте ещё раз"));xhr.onabort=()=>reject(new DOMException("Загрузка отменена","AbortError"));
        const form=new FormData();form.set("chatId",chatId);form.set("clientMessageId",clientId.current);form.set("kind",kind);form.set("text",caption);if(replyToId)form.set("replyToId",replyToId);form.set("file",file);xhr.send(form);
      });
      request.current=null;close();await sent(chatId);
    }catch(error){if(live.current&&!(error instanceof DOMException&&error.name==="AbortError"))notify(error);}
    finally{request.current=null;if(live.current)setUploading(false);}
  }
  return <Dialog title={kind==="video"?"Отправить видео":"Отправить файл"} close={cancel}><div className="attachment-upload"><strong>{file.name}</strong><span>{fileSize(file.size)} · до {kind==="video"?"500":"100"} МБ</span><label>Подпись<textarea aria-label="Подпись к файлу" maxLength={10000} value={caption} disabled={uploading} onChange={e=>{clientId.current=v7();setCaption(e.target.value);}}/></label>{uploading&&<div role="status"><progress max={100} value={progress}/><span>{progress<100?`Загрузка ${progress}%`:"Завершаем отправку…"}</span></div>}<div className="inline-actions"><button type="button" className="primary-button" disabled={uploading} onClick={()=>void upload()}>Отправить файл</button><button type="button" className="secondary-button" onClick={cancel}>{uploading?"Отменить загрузку":"Отмена"}</button></div></div></Dialog>;
}
