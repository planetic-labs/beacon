import { useEffect, type RefObject } from "react";
import type { Socket } from "socket.io-client";
import type { Chat, OfflineSnapshot } from "@beacon/shared";
import { api, ApiError } from "./ui";
import { localAccount, localGeneration, readCache, writeCache, pendingReads, acknowledgeRead } from "../offline";
// Bounded authoritative snapshots avoid an ever-growing change log on either side.
// Replacing the entire window reconciles edits, reactions and tombstones as well as new messages.
export function useOfflineSync(userId:string|undefined,selected:string|null,socket:RefObject<Socket|null>) {
  useEffect(()=>{
    if(!userId)return;
    let live=true,running=false,fullRequested=true;
    const dirty=new Set<string>();
    const generation=localGeneration();
    const valid=()=>live&&localAccount()===userId&&localGeneration()===generation;
    const sync=async()=>{
      if(!valid()||!navigator.onLine||document.hidden)return;
      if(running)return;running=true;
      const full=fullRequested;fullRequested=false;
      const changed=new Set(dirty);dirty.clear();
      try {
        // A cached identity is sufficient for reading, never for replaying writes or trusting access.
        await api("me","GET",undefined,true);
        for(const read of await pendingReads(userId)) {
          if(!valid())return;
          try{await api(`chats/${read.chatId}/read`,"POST",{messageId:read.messageId});await acknowledgeRead(userId,read.chatId,read.messageId);}
          catch(error){if(error instanceof ApiError&&[403,404].includes(error.status))await acknowledgeRead(userId,read.chatId,read.messageId);else throw error;}
        }
        const chats=await api<Chat[]>("chats","GET",undefined,true);
        const paused=await readCache<boolean>("background-paused");
        const epoch=await readCache<number>("history-epoch")??0;
        const ordered=chats.filter(c=>(!paused||c.id===selected)&&(full||changed.has(c.id)||c.id===selected)).sort((a,b)=>a.id===selected?-1:b.id===selected?1:(b.lastAt??"").localeCompare(a.lastAt??""));
        for(const chat of ordered){
          if(!valid()||document.hidden||!navigator.onLine)break;
          try {
            const snapshot=await api<OfflineSnapshot>(`chats/${chat.id}/offline`,"GET",undefined,true);
            if(!valid())break;
            if(!snapshot||!Array.isArray(snapshot.messages))continue;
            // A clear operation during the request wins over its delayed response.
            if(await readCache<boolean>("background-paused")&&!paused)break;
            await writeCache(`history/${chat.id}`,snapshot,userId,epoch);
          }catch(error){
            if(error instanceof ApiError&&(error.status===403||error.status===404))continue;
            break;
          }
          // Yield between chats so the foreground UI and its requests retain priority.
          await new Promise(resolve=>setTimeout(resolve,30));
        }
      }catch{/* Retry after reconnect, visibility or the recovery interval. */}
      finally{running=false;if((fullRequested||dirty.size)&&valid())void sync();}
    };
    const visible=()=>{if(!document.hidden){fullRequested=true;void sync();}};
    const run=()=>{fullRequested=true;void sync();};
    const chatChanged=({chatId}:{chatId:string})=>{dirty.add(chatId);void sync();};
    let readTimer:ReturnType<typeof setTimeout>|undefined;
    const readSynced=(event:Event)=>{
      dirty.add((event as CustomEvent<{chatId:string}>).detail.chatId);
      clearTimeout(readTimer);readTimer=setTimeout(()=>void sync(),1000);
    };
    const s=socket.current;
    s?.on("connect",run);s?.on("sync",run);s?.on("chat.changed",chatChanged);s?.on("profile.changed",run);
    window.addEventListener("online",run);window.addEventListener("beacon:resume-download",run);window.addEventListener("beacon:read-synced",readSynced);document.addEventListener("visibilitychange",visible);
    const timer=setInterval(run,300000);run();
    return()=>{live=false;clearInterval(timer);clearTimeout(readTimer);s?.off("connect",run);s?.off("sync",run);s?.off("chat.changed",chatChanged);s?.off("profile.changed",run);window.removeEventListener("online",run);window.removeEventListener("beacon:resume-download",run);window.removeEventListener("beacon:read-synced",readSynced);document.removeEventListener("visibilitychange",visible);};
  },[userId,selected,socket]);
}
