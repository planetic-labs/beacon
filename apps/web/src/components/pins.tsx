import { useEffect, useRef, useState, type RefObject } from "react";
import type { Socket } from "socket.io-client";
import type { PinPage } from "@beacon/shared";
import { api, Dialog } from "./ui";
import { Icon } from "./icon";
export function PinnedMessages({chatId,socket,connectionKey,jump,notify,changed,onChanged}:{chatId:string;socket:RefObject<Socket|null>;connectionKey:string;jump:(id:string)=>void;notify:(error:unknown)=>void;changed:number;onChanged?:(id:string,pinned:boolean)=>void}) {
  const [page,setPage]=useState<PinPage>({pins:[],total:0}),[open,setOpen]=useState(false),[busy,setBusy]=useState(false);
  const live=useRef(0);
  useEffect(()=>{
    const version=++live.current;let generation=0;
    const refresh=async()=>{const current=++generation;try{const result=await api<PinPage>(`chats/${chatId}/pins`);if(live.current===version&&current===generation&&Array.isArray(result.pins))setPage(result);}catch{/* Losing membership must not leave private pins visible. */if(live.current===version)setPage({pins:[],total:0});}};
    const event=({chatId:id}:{chatId:string})=>{if(id===chatId)void refresh();};
    void refresh();const s=socket.current;s?.on("chat.changed",event);s?.on("sync",refresh);s?.on("connect",refresh);
    return()=>{live.current++;s?.off("chat.changed",event);s?.off("sync",refresh);s?.off("connect",refresh);};
  },[chatId,socket,connectionKey,changed]);
  async function more(){
    if(!page.next||busy)return;setBusy(true);const version=live.current;
    try{const next=await api<PinPage>(`chats/${chatId}/pins?beforeId=${page.next.id}&beforeAt=${encodeURIComponent(page.next.at)}`);if(live.current===version)setPage(old=>({...next,pins:[...old.pins,...next.pins]}));}catch(error){notify(error);}finally{setBusy(false);}
  }
  async function remove(id:string){setBusy(true);try{await api(`messages/${id}/pin`,"PATCH",{pinned:false});onChanged?.(id,false);const next=await api<PinPage>(`chats/${chatId}/pins`);setPage(next);}catch(error){notify(error);}finally{setBusy(false);}}
  if(!page.total)return null;
  const first=page.pins[0];
  return <><div className="pinned-strip"><Icon name="pin"/><button className="pinned-preview" onClick={()=>jump(first.id)}><strong>Закреплённое сообщение</strong><span>{first.authorName}: {first.text}</span></button><button className="text-button" onClick={()=>setOpen(true)} aria-label="Все закреплённые сообщения">Все · {page.total}</button></div>{open&&<Dialog title={`Закреплённые сообщения · ${page.total}`} close={()=>setOpen(false)}><div className="pinned-list">{page.pins.map(pin=><div key={pin.id}><button className="pinned-item" onClick={()=>{setOpen(false);jump(pin.id);}}><strong>{pin.authorName}</strong><span>{pin.text}</span></button><button className="text-button" disabled={busy} onClick={()=>void remove(pin.id)}>Открепить</button></div>)}{page.next&&<button className="text-button" disabled={busy} onClick={()=>void more()}>Ещё закреплённые</button>}</div></Dialog>}</>;
}
