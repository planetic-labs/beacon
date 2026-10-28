import { rememberRead, acknowledgeRead, storageProblem } from "../offline";
import { Icon } from "./icon";
import { useCallback, useEffect, useRef, useState, type RefObject, type ReactNode } from "react";
import { deliveryLabel, type Chat, type ChatActivity, type Mention, type Message, type Receipt, type User } from "@beacon/shared";
import type { Socket } from "socket.io-client";
import { api } from "./ui";
export function useChatFeatures(userId: string | undefined, selected: string | null, messages: Message[], chats: Chat[], feed: RefObject<HTMLDivElement | null>, socket: RefObject<Socket | null>, refreshLists: () => Promise<void>, connectionKey: string) {
  const [receipts,setReceipts] = useState<Receipt[]>([]);
  const [activities,setActivities] = useState<ChatActivity[]>([]);
  const delivered = useRef(new Map<string,string>()), read = useRef(new Map<string,string>());
  const context = useRef(""); context.current=`${userId}/${selected}`;
  const active = useRef<{chatId:string;kind:ChatActivity["kind"]}|null>(null), idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadReceipts = useCallback(async () => {
    if (!selected) { setReceipts([]); return; }
    const current=context.current;
    const result = await api<Receipt[]>(`chats/${selected}/receipts`);
    if (current===context.current && Array.isArray(result)) setReceipts(result);
  },[selected]);
  useEffect(()=>{ delivered.current.clear(); read.current.clear(); setReceipts([]); setActivities([]); },[userId]);
  useEffect(()=>{
    setReceipts([]);
    let live=true;
    if (selected && userId) void api<Receipt[]>(`chats/${selected}/receipts`).then(r=>{if(live&&Array.isArray(r))setReceipts(r);}).catch(()=>{});
    return()=>{live=false;};
  },[selected,userId]);
  useEffect(()=>{
    if (!userId) return;
    const s=socket.current;
    if (!s) return;
    const changed=({chatId}:{chatId:string})=>{if(chatId===selected)void loadReceipts().catch(()=>{});};
    const receive=(value:ChatActivity)=>{
      if(value.userId===userId || value.expiresAt<Date.now())return;
      setActivities(items=>[...items.filter(a=>a.source!==value.source),...(value.kind?[value]:[])]);
    };
    const sync=()=>{void loadReceipts().catch(()=>{});};
    s.on("receipt.changed",changed);s.on("chat.changed",changed);s.on("chat.activity",receive);s.on("connect",sync);s.on("sync",sync);
    const timer=setInterval(()=>setActivities(items=>items.filter(a=>a.expiresAt>Date.now())),1000);
    return()=>{s.off("receipt.changed",changed);s.off("chat.changed",changed);s.off("chat.activity",receive);s.off("connect",sync);s.off("sync",sync);clearInterval(timer);};
  },[userId,selected,loadReceipts,socket,connectionKey]);
  useEffect(()=>{
    if(!userId)return;
    const items=chats.filter(c=>c.lastMessageId && delivered.current.get(c.id)!==c.lastMessageId).map(c=>({chatId:c.id,messageId:c.lastMessageId!}));
    items.forEach(c=>delivered.current.set(c.chatId,c.messageId));
    const current=userId;
    void (async()=>{for(let i=0;i<items.length;i+=200){const batch=items.slice(i,i+200);try{await api("receipts/delivered","POST",{items:batch});}catch{if(context.current.startsWith(`${current}/`))batch.forEach(c=>{if(delivered.current.get(c.chatId)===c.messageId)delivered.current.delete(c.chatId);});}}})();
  },[chats,userId]);
  useEffect(()=>{
    if(!selected || !userId || !feed.current)return;
    let timer:ReturnType<typeof setTimeout>|undefined, sending=false, candidate:Message|undefined, live=true;
    const visible=new Set<string>();
    const flush=async()=>{
      if(sending || !candidate || document.hidden)return;
      const message=candidate;candidate=undefined;
      if((read.current.get(selected)??"")>=message.createdAt)return;
      sending=true;
      try{await rememberRead(userId,selected,message).catch(storageProblem);await api(`chats/${selected}/read`,"POST",{messageId:message.id});await acknowledgeRead(userId,selected,message.id);window.dispatchEvent(new CustomEvent("beacon:read-synced",{detail:{chatId:selected}}));if(live){read.current.set(selected,message.createdAt);await refreshLists();}}
      catch{/* A later visibility event or refresh retries. */}
      finally{sending=false;if(live&&candidate)void flush();}
    };
    const schedule=()=>{
      if(document.hidden)return;
      const last=messages.filter(m=>visible.has(m.id)).at(-1);
      if(last){candidate=last;clearTimeout(timer);timer=setTimeout(()=>void flush(),150);}
    };
    const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{const id=(entry.target as HTMLElement).dataset.messageId!;if(entry.isIntersecting && entry.intersectionRatio>=0.1)visible.add(id);else visible.delete(id);});schedule();},{root:feed.current,threshold:0.1});
    feed.current.querySelectorAll<HTMLElement>("[data-message-id]").forEach(node=>observer.observe(node));
    document.addEventListener("visibilitychange",schedule);
    return()=>{live=false;observer.disconnect();clearTimeout(timer);document.removeEventListener("visibilitychange",schedule);};
  },[selected,userId,messages,feed,refreshLists]);
  const activity=useCallback((kind:ChatActivity["kind"],chatId=selected)=>{
    clearTimeout(idle.current);
    if(!chatId)return;
    if(!document.hidden && socket.current?.connected)socket.current.volatile.emit("chat.activity",{chatId,kind});
    active.current=kind?{chatId,kind}:null;
    if(kind==="typing")idle.current=setTimeout(()=>{
      if(socket.current?.connected)socket.current.volatile.emit("chat.activity",{chatId,kind:null});active.current=null;
    },3500);
  },[selected,socket]);
  useEffect(()=>{
    const stop=()=>{const value=active.current;if(value){socket.current?.volatile.emit("chat.activity",{chatId:value.chatId,kind:null});active.current=null;}clearTimeout(idle.current);};
    const hidden=()=>{if(document.hidden)stop();};
    const timer=setInterval(()=>{const value=active.current;if(value&&!document.hidden&&socket.current?.connected)socket.current.volatile.emit("chat.activity",value);},2500);
    document.addEventListener("visibilitychange",hidden);
    return()=>{stop();clearInterval(timer);document.removeEventListener("visibilitychange",hidden);};
  },[selected,userId,socket]);
  const recording=useCallback((kind:"audio"|"circle"|null)=>activity(kind),[activity]);
  const names=[...new Map(activities.filter(a=>a.chatId===selected&&a.expiresAt>Date.now()).map(a=>[a.userId,a])).values()];
  const activityText=names.slice(0,3).map(a=>`${a.name} ${a.kind==="audio"?"записывает голосовое…":a.kind==="circle"?"записывает видеокружок…":"печатает…"}`).join(", ");
  return {receipts,activity,recording,activityText};
}
export function DeliveryStatus({receipts,message,open}:{receipts:Receipt[];message:Message;open?:()=>void}) {
  const label=deliveryLabel(receipts,message.authorId,message.createdAt);
  const details=receipts.filter(r=>r.userId!==message.authorId&&r.joinedAt<=message.createdAt).map(r=>`${r.name}: ${r.readAt>=message.createdAt?"Прочитано":r.deliveredAt>=message.createdAt?"Доставлено":"Отправлено"}`).join("\n");
  // In groups, blue means everyone has read; partial receipts stay grey.
  const state=label==="Прочитано"?"read":label.startsWith("Прочитано")||label.startsWith("Доставлено")?"delivered":"sent";
  if(state==="sent")return null;
  return <button type="button" className={`delivery-status ${state}`} data-state={state} title={details||label} aria-label={label} onClick={open}><Icon name={state==="read"?"checks":"check"}/></button>;
}
export function MentionText({text,mentions=[],userId,open}:{text:string;mentions?:Mention[];userId?:string;open?:(id:string)=>void}) {
  const result:ReactNode[]=[];let offset=0;
  for(const m of [...mentions].sort((a,b)=>a.start-b.start)){
    if(m.start<offset||m.start+m.length>text.length)continue;
    result.push(text.slice(offset,m.start));
    result.push(<button type="button" key={`${m.start}:${m.userId}`} className={`message-mention ${m.userId===userId?"self":""}`} onClick={()=>open?.(m.userId)}>{text.slice(m.start,m.start+m.length)}</button>);offset=m.start+m.length;
  }
  result.push(text.slice(offset));return <>{result}</>;
}
export function MentionSuggestions({draft,cursor,members,choose}:{draft:string;cursor:number;members:User[];choose:(user:User,start:number,end:number)=>void}) {
  const match=cursor<0?null:/(?:^|\s)@([^@\n]{0,80})$/u.exec(draft.slice(0,cursor));
  const [index,setIndex]=useState(0);
  const query=match?.[1].toLowerCase().replaceAll("ё","е")??"";
  const options=match?members.filter(u=>!u.banned&&u.name.toLowerCase().replaceAll("ё","е").includes(query)).slice(0,8):[];
  const optionsRef=useRef(options);optionsRef.current=options;
  const chooseRef=useRef(choose);chooseRef.current=choose;
  const matchRef=useRef(match);matchRef.current=match;
  const cursorRef=useRef(cursor);cursorRef.current=cursor;
  useEffect(()=>setIndex(0),[query]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      const items=optionsRef.current,m=matchRef.current;if(!items.length||!m||e.isComposing)return;
      if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();e.stopImmediatePropagation();setIndex(i=>(i+(e.key==="ArrowDown"?1:-1)+items.length)%items.length);}
      if(e.key==="Enter"||e.key==="Tab"){e.preventDefault();e.stopImmediatePropagation();const user=items[index%items.length];chooseRef.current(user,cursorRef.current-m[1].length-1,cursorRef.current);}
    };
    const input=document.getElementById("composer");input?.addEventListener("keydown",key,true);return()=>input?.removeEventListener("keydown",key,true);
  },[index]);
  if(!options.length||!match)return null;
  return <div className="mention-suggestions" role="listbox" aria-label="Упомянуть участника">{options.map((u,i)=><button type="button" role="option" aria-selected={i===index} key={u.id} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(u,cursor-match[1].length-1,cursor)}>{u.name}</button>)}</div>;
}
