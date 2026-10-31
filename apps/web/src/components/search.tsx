import { Button } from "./app-button";
import { useEffect, useRef, useState } from "react";
import type { SearchResults, SearchHit, User, Chat } from "@beacon/shared";
import { api, Avatar } from "./ui";
import { Icon } from "./icon";
const empty:SearchResults={people:[],chats:[],messages:[]};
export function SearchPanel({revision=0,scope,users,chats,openChat,openPerson,openMessage,close}:{revision?:number;scope?:{id:string;name:string};users:User[];chats:Chat[];openChat:(id:string)=>void;openPerson:(id:string)=>void;openMessage:(hit:SearchHit)=>void;close:()=>void}){
  const [chatId,setChatId]=useState(scope?.id??""),[filtersOpen,setFiltersOpen]=useState(!!scope);
  const conversations=scope&&!chats.some(c=>c.id===scope.id)?[{id:scope.id,name:scope.name},...chats]:chats;
  const [query,setQuery]=useState(""),[author,setAuthor]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState("");
  const [results,setResults]=useState<SearchResults>(empty),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const generation=useRef(0);
  const params=()=>new URLSearchParams({query:query.trim(),...(chatId?{chatId}:{}),...(author?{authorId:author}:{}),...(from?{from}:{}),...(to?{to}:{})});
  useEffect(()=>{
    const current=++generation.current;setResults(empty);setError("");
    if(query.trim().length<2){setBusy(false);return;}
    setBusy(true);
    const timer=setTimeout(()=>{void api<SearchResults>(`search?${params()}`).then(r=>{if(current===generation.current)setResults(r);}).catch(e=>{if(current===generation.current)setError(e.message);}).finally(()=>{if(current===generation.current)setBusy(false);});},250);
    return()=>{clearTimeout(timer);generation.current++;};
  },[query,author,from,to,chatId,revision]);
  async function more(){if(!results.next||busy)return;const current=generation.current;setBusy(true);setError("");const p=params();p.set("beforeId",results.next.id);p.set("beforeAt",results.next.at);try{const r=await api<SearchResults>(`search?${p}`);if(current===generation.current)setResults(old=>({...old,messages:[...old.messages,...r.messages],next:r.next}));}catch(e){if(current===generation.current)setError(e instanceof Error?e.message:String(e));}finally{if(current===generation.current)setBusy(false);}}
  return <section className="chat-list search-panel"><header className="list-header"><div className="list-heading"><h1>Поиск</h1><Button className="icon-button" onClick={close} aria-label="Закрыть поиск"><Icon name="back"/></Button></div><input className="search-input" autoFocus type="search" value={query} onChange={e=>setQuery(e.target.value)} maxLength={100} placeholder={chatId?"Сообщения в чате":"Люди, чаты, сообщения"} aria-label="Поисковый запрос"/><details className="search-filters" open={filtersOpen} onToggle={e=>setFiltersOpen(e.currentTarget.open)}><summary>Фильтры сообщений</summary><label>Переписка<select value={chatId} onChange={e=>setChatId(e.target.value)}><option value="">Все переписки</option>{conversations.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Автор<select value={author} onChange={e=>setAuthor(e.target.value)}><option value="">Все авторы</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label>С даты<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>По дату<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></details></header><div className="chat-rows" aria-busy={busy}>
    {query.trim().length<2&&<p className="search-hint">Введите хотя бы два символа</p>}{error&&<p role="alert" className="search-hint">{error}</p>}
    {!!results.people.length&&<><h2 className="search-section">Люди</h2>{results.people.map(u=><Button className="chat-row" key={u.id} onClick={()=>openPerson(u.id)}><Avatar name={u.name} image={u.image}/><span>{u.name}</span></Button>)}</>}
    {!!results.chats.length&&<><h2 className="search-section">Чаты</h2>{results.chats.map(c=><Button className="chat-row" key={c.id} onClick={()=>openChat(c.id)}><Icon name="chats"/><span>{c.name}</span></Button>)}</>}
    {!!results.messages.length&&<h2 className="search-section">Сообщения</h2>}{results.messages.map(m=><Button className="search-message" key={m.id} onClick={()=>openMessage(m)}><strong>{m.chatName}</strong><small>{m.authorName} · {new Date(m.createdAt).toLocaleString("ru")}</small><span>{excerpt(m.text,query)}</span></Button>)}
    {busy&&<p className="search-hint" role="status">Ищем…</p>}{!busy&&!error&&query.trim().length>=2&&!results.people.length&&!results.chats.length&&!results.messages.length&&<p className="search-hint">Ничего не найдено</p>}{results.next&&<Button className="text-button" disabled={busy} onClick={()=>void more()}>Ещё сообщения</Button>}
  </div></section>;
}
function excerpt(text:string,query:string){const word=query.toLowerCase().replaceAll("ё","е").match(/[\p{L}\p{N}]+/u)?.[0]??"";const index=text.toLowerCase().replaceAll("ё","е").indexOf(word);const start=Math.max(0,index-50);return `${start?"…":""}${text.slice(start,start+220)}${text.length>start+220?"…":""}`;}
