import { createDraftBuffer } from "../lib/draft-buffer";
import { localDrafts, saveDraft, storageProblem } from "../offline";
import { useEffect, useRef, type RefObject } from "react";
import type { Socket } from "socket.io-client";
import type { Mention } from "@beacon/shared";
import { api, ApiError } from "./ui";
type Value={text:string;mentions:Mention[]};
type Row={chatId:string;draft:Value;revision:number};
// Private server copies; local edits survive temporary disconnects and conflicting saves.
export function useDraftSync(userId:string|undefined,socket:RefObject<Socket|null>,connectionKey:string,apply:(id:string,value:Value)=>void){
  const callbacks=useRef({apply});callbacks.current={apply};
  const controller=useRef<{change:(id:string,value:Value)=>void; flush:()=>void}>({change:()=>{},flush:()=>{}});
  useEffect(()=>{
    if(!userId)return;
    let live=true,ready=false,running=false,refreshing=false;
    const revisions=new Map<string,number>(),dirty=new Map<string,Value>(),legacy=new Map<string,Value>();
    const storageKey=`beacon:unsynced-drafts:${userId}`;
    try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??"[]");if(Array.isArray(saved))for(const [id,value] of saved){if(typeof id==="string"&&value&&typeof value.text==="string"&&Array.isArray(value.mentions)){legacy.set(id,value);}}}catch{/* Storage may be unavailable. */}
    const restored=localDrafts(userId).then(rows=>{
      if(!live)return;
      for(const row of rows){
        if(dirty.has(row.chatId))continue;
        const value=legacy.get(row.chatId)??{text:row.text,mentions:row.mentions};
        if(row.dirty||legacy.has(row.chatId))dirty.set(row.chatId,value);
        if(legacy.has(row.chatId))void saveDraft(userId,row.chatId,value).catch(storageProblem);
        callbacks.current.apply(row.chatId,value);
      }
      const known=new Set(rows.map(row=>row.chatId));
      for(const [id,value] of legacy)if(!known.has(id)&&!dirty.has(id)){
        dirty.set(id,value);callbacks.current.apply(id,value);
        void saveDraft(userId,id,value).catch(storageProblem);
      }
      try{sessionStorage.removeItem(storageKey);}catch{/* Legacy storage may be blocked. */}
    }).catch(storageProblem);
    const persist=()=>{try{if(dirty.size)sessionStorage.setItem(storageKey,JSON.stringify([...dirty]));else sessionStorage.removeItem(storageKey);}catch{/* The server copy remains primary. */}};
    const local = createDraftBuffer<Value>((id,value)=>{void saveDraft(userId,id,value).catch(storageProblem);}, persist);
    let timer:ReturnType<typeof setTimeout>|undefined;
    const refresh=async()=>{
      if(refreshing||!live)return;refreshing=true;
      try{
        const rows=await api<Row[]>("drafts");if(!live||!Array.isArray(rows))return;
        for(const row of rows){
          // Never overwrite a revision received after this request began.
          if(row.revision<(revisions.get(row.chatId)??0))continue;
          revisions.set(row.chatId,row.revision);
          if(!dirty.has(row.chatId)){
            callbacks.current.apply(row.chatId,row.draft);
            void saveDraft(userId,row.chatId,row.draft,false).catch(storageProblem);
          }
        }
        ready=true;
      }catch{/* Retry on reconnect, visibility or the periodic recovery. */}
      finally{refreshing=false;}
    };
    const flush=async()=>{
      if(running||!live)return;running=true;
      try{
        if(!ready)await refresh();
        if(!ready)return;
        for(const [id,value] of dirty){
          try{
            const row=await api<Row>(`chats/${id}/draft`,"PATCH",{...value,revision:revisions.get(id)??0});
            if(!live)return;
            revisions.set(id,row.revision);
            if(dirty.get(id)===value){
              local.flush();dirty.delete(id);
              void saveDraft(userId,id,value,false).catch(storageProblem);
            }
          }catch(error){
            if(error instanceof ApiError&&error.status===409){await refresh();break;}
            if(error instanceof ApiError&&(error.status===403||error.status===404))dirty.delete(id);
            break;
          }
        }
      }finally{if(live)persist();running=false;if(live&&dirty.size)timer=setTimeout(()=>void flush(),1500);}
    };
    controller.current={change:(id,value)=>{dirty.set(id,value);local.change(id,value);if(!value.text)local.flush();clearTimeout(timer);timer=setTimeout(()=>void flush(),600);},flush:local.flush};
    const sync=()=>{void restored.then(()=>{if(live)return refresh();}).then(()=>{if(live&&dirty.size)void flush();});};
    const visible=()=>{if(!document.hidden)sync();};
    const hide=()=>{if(document.hidden){local.flush();void flush();}};
    const pagehide=()=>{local.flush();persist();};
    const s=socket.current;
    s?.on("connect",sync);s?.on("sync",sync);s?.on("draft.changed",sync);
    window.addEventListener("pagehide",pagehide);window.addEventListener("online",sync);document.addEventListener("visibilitychange",visible);document.addEventListener("visibilitychange",hide);
    void restored.then(sync);const recovery=setInterval(sync,30000);
    return()=>{local.flush();persist();live=false;clearTimeout(timer);clearInterval(recovery);s?.off("connect",sync);s?.off("sync",sync);s?.off("draft.changed",sync);window.removeEventListener("pagehide",pagehide);window.removeEventListener("online",sync);document.removeEventListener("visibilitychange",visible);document.removeEventListener("visibilitychange",hide);controller.current={change:()=>{},flush:()=>{}};};
  },[userId,socket,connectionKey]);
  return controller;
}
