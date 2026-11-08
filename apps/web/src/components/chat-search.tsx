import {useEffect,useRef,useState} from "react";
import type {SearchHit,SearchResults} from "@beacon/shared";
import {ArrowLeft,ChevronUp,ChevronDown,X} from "lucide-react";
import {Button} from "./app-button";
import {api} from "./ui";
import "../chat-search.css";

export function ChatSearch({chatId,jump,close}:{chatId:string;jump:(hit:SearchHit)=>Promise<void>;close:()=>void}){
 const [query,setQuery]=useState(""),[hits,setHits]=useState<SearchHit[]>([]),[index,setIndex]=useState(-1),[total,setTotal]=useState<number|undefined>();
 const [next,setNext]=useState<SearchResults["next"]>(),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const generation=useRef(0),jumpRef=useRef(jump),input=useRef<HTMLInputElement>(null);jumpRef.current=jump;
 useEffect(()=>{
  const token=++generation.current;setHits([]);setIndex(-1);setTotal(undefined);setNext(undefined);setError("");
  if(query.trim().length<2){setBusy(false);return;}
  setBusy(true);
  const timer=setTimeout(()=>{void (async()=>{
   try{
    const result=await api<SearchResults>(`search?${new URLSearchParams({query:query.trim(),chatId})}`);
    if(token!==generation.current)return;
    setHits(result.messages);setTotal(result.total);setNext(result.next);
    if(result.messages.length){setIndex(0);await jumpRef.current(result.messages[0]);}
   }catch(e){if(token===generation.current)setError(e instanceof Error?e.message:String(e));}
   finally{if(token===generation.current)setBusy(false);}
  })();},250);
  return()=>{clearTimeout(timer);generation.current++;};
 },[query,chatId]);
 async function move(direction:number){
  if(busy)return;
  const target=index+direction,token=generation.current;
  if(target<0)return;
  setBusy(true);setError("");
  try{
   let items=hits;
   if(target>=items.length&&next){
    const result=await api<SearchResults>(`search?${new URLSearchParams({query:query.trim(),chatId,beforeId:next.id,beforeAt:next.at})}`);
    if(token!==generation.current)return;
    items=[...items,...result.messages];setHits(items);setNext(result.next);
   }
   if(items[target]){setIndex(target);await jumpRef.current(items[target]);}
  }catch(e){if(token===generation.current)setError(e instanceof Error?e.message:String(e));}
  finally{if(token===generation.current)setBusy(false);}
 }
 const counter=query.trim().length<2?"Введите хотя бы два символа":index<0?(busy?"Ищем…":"Ничего не найдено"):`${index+1} из ${total??`${hits.length}${next?"+":""}`}`;
 return <div className="conversation-search" aria-label="Поиск в переписке">
  <div className="conversation-search-header">
   <Button className="conversation-search-back" aria-label="Вернуться в чат" onClick={close}><ArrowLeft/></Button>
   <div className="conversation-search-input"><input ref={input} autoFocus type="search" aria-label="Поиск сообщений в чате" placeholder="Поиск в чате" maxLength={100} value={query} onChange={e=>setQuery(e.target.value)}/><Button aria-label="Очистить поиск" onClick={()=>{setQuery("");input.current?.focus();}}><X/></Button></div>
  </div>
  <div className="conversation-search-footer">
   <span role="status" aria-live="polite">{counter}</span>
   <Button aria-label="Предыдущее найденное сообщение" disabled={busy||index<0||(!next&&index>=hits.length-1)} onClick={()=>void move(1)}><ChevronUp/></Button>
   <Button aria-label="Следующее найденное сообщение" disabled={busy||index<=0} onClick={()=>void move(-1)}><ChevronDown/></Button>
  </div>
  {error&&<div role="alert" className="conversation-search-error">{error}</div>}
 </div>;
}
