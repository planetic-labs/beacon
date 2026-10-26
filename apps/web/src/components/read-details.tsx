import { useEffect, useRef, useState, type RefObject } from "react";
import type { Socket } from "socket.io-client";
import type { MessageReceipt } from "@beacon/shared";
import { api, Avatar, Dialog } from "./ui";
export function ReadDetails({messageId,chatId,socket,close}:{messageId:string;chatId:string;socket:RefObject<Socket|null>;close:()=>void}) {
 const [rows,setRows]=useState<MessageReceipt[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const generation=useRef(0);
 useEffect(()=>{
  const version=++generation.current;let request=0;
  const refresh=async()=>{const current=++request;try{const result=await api<MessageReceipt[]>(`messages/${messageId}/receipts`);if(version===generation.current&&current===request&&Array.isArray(result)){setRows(result);setError("");}}catch(e){if(version===generation.current){setRows([]);setError(e instanceof Error?e.message:String(e));}}finally{if(version===generation.current)setLoading(false);}};
  void refresh();const changed=({chatId:id}:{chatId:string})=>{if(id===chatId)void refresh();};const s=socket.current;s?.on("receipt.changed",changed);s?.on("chat.changed",changed);s?.on("connect",refresh);s?.on("sync",refresh);
  return()=>{generation.current++;s?.off("receipt.changed",changed);s?.off("chat.changed",changed);s?.off("connect",refresh);s?.off("sync",refresh);};
 },[messageId,chatId]);
 const groups=[["read","Прочитали"],["delivered","Доставлено"],["sent","Ещё не доставлено"]] as const;
 return <Dialog title="Подробности прочтения" close={close}>{loading&&<p role="status">Загружаем…</p>}{error&&<p role="alert">{error}</p>}{!loading&&!error&&<><p className="field-note">Текущие участники, которые состояли в чате на момент отправки. Подтверждения учитываются со всех устройств.</p>{groups.map(([status,label])=>{const people=rows.filter(r=>r.status===status);return people.length?<section className="receipt-section" key={status}><h3>{label} · {people.length}</h3>{people.map(person=><div className="receipt-person" key={person.userId}><Avatar name={person.name} image={person.image}/><div><strong>{person.name}</strong>{status!=="sent"&&<span>{(status==="read"?person.readAt:person.deliveredAt)?new Date((status==="read"?person.readAt:person.deliveredAt)!).toLocaleString("ru"):"Время не зафиксировано"}</span>}{status==="read"&&person.deliveredAt&&<small>Доставлено: {new Date(person.deliveredAt).toLocaleString("ru")}</small>}</div></div>)}</section>:null;})}{!rows.length&&<p>Других получателей нет.</p>}</>}</Dialog>;
}
