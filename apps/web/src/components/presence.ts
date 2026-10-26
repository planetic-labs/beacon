import { useEffect, useState, type RefObject } from "react";
import type { Socket } from "socket.io-client";
import type { Presence } from "@beacon/shared";
import { api } from "./ui";
export function usePresence(userId:string|undefined,socket:RefObject<Socket|null>,connectionKey:string) {
  const [people,setPeople]=useState<Map<string,Presence>>(new Map());
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{
    setPeople(new Map());if(!userId||!socket.current)return;
    const s=socket.current;let live=true,running=false,again=false,connectionId:string|undefined;
    const refresh=async()=>{
      if(running){again=true;return;}running=true;
      try{const rows=await api<Presence[]>("presence");if(live&&Array.isArray(rows))setPeople(new Map(rows.map(p=>[p.userId,p])));}
      catch{/* Keep the last known visit when reconnecting. */}
      finally{running=false;if(again&&live){again=false;void refresh();}}
    };
    const heartbeat=()=>{if(s.connected)s.volatile.emit("presence.heartbeat",{visible:!document.hidden});};
    const connect=()=>{heartbeat();void refresh();};
    const changed=()=>{void refresh();};
    const visible=()=>{heartbeat();if(!document.hidden)void refresh();};
    const ready=({id}:{id:string})=>{connectionId=id;};
    const leave=()=>{
      if(connectionId&&typeof navigator.sendBeacon==="function")navigator.sendBeacon("/api/v1/presence/leave",new Blob([JSON.stringify({connectionId})],{type:"application/json"}));
    };
    s.on("presence.connection",ready);
    window.addEventListener("pagehide",leave);window.addEventListener("pageshow",visible);
    s.on("connect",connect);s.on("presence.changed",changed);s.on("sync",changed);
    document.addEventListener("visibilitychange",visible);
    connect();
    const timer=setInterval(()=>{setNow(Date.now());if(!document.hidden){heartbeat();void refresh();}},25000);
    return()=>{live=false;clearInterval(timer);window.removeEventListener("pagehide",leave);window.removeEventListener("pageshow",visible);s.off("presence.connection",ready);s.off("connect",connect);s.off("presence.changed",changed);s.off("sync",changed);document.removeEventListener("visibilitychange",visible);if(s.connected)s.volatile.emit("presence.heartbeat",{visible:false});};
  },[userId,socket,connectionKey]);
  return {people,now};
}
export function presenceText(value:Presence|undefined,now:number) {
  if(value?.online)return "В сети";
  if(!value?.lastSeenAt)return "Не в сети";
  const seen=new Date(value.lastSeenAt),minutes=Math.max(0,Math.floor((now-seen.getTime())/60000));
  if(!Number.isFinite(seen.getTime()))return "Не в сети";
  if(minutes<1)return "Был(а) только что";
  if(minutes<60)return `Был(а) ${minutes} мин. назад`;
  return `Был(а) ${seen.toLocaleString("ru",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",...(now-seen.getTime()>365*86400000?{year:"numeric"}: {})})}`;
}
