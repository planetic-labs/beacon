import { Button } from "./app-button";
import { useEffect, useRef, useState } from "react";
import type { SearchResults, SearchHit, User, Chat } from "@beacon/shared";
import { api, Avatar } from "./ui";
import { Search, X, SlidersHorizontal } from "lucide-react";
import "../search.css";
import { chatDate } from "../lib/chat-date";
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
  const filterCount=[chatId,author,from,to].filter(Boolean).length;
  return <section className="chat-list search-panel" aria-label="Поиск по доступным чатам">
    <header className="list-header search-header">
      <h1 className="search-title">Поиск</h1>
      <div className="search-query-pill">
        <Search className="search-query-icon" aria-hidden="true"/>
        <input className="search-input" autoFocus type="search" value={query} onChange={e=>setQuery(e.target.value)} maxLength={100} placeholder="Поиск по чатам" aria-label="Поисковый запрос"/>
        <Button className="icon-button search-close" onClick={close} aria-label="Закрыть поиск"><X/></Button>
      </div>
      <details className="search-filters" open={filtersOpen} onToggle={e=>setFiltersOpen(e.currentTarget.open)}>
        <summary><SlidersHorizontal size={17} aria-hidden="true"/><span>Фильтры сообщений</span>{!!filterCount&&<span className="search-filter-count">{filterCount}</span>}</summary>
        <div className="search-filter-fields">
          <label>Переписка<select value={chatId} onChange={e=>setChatId(e.target.value)}><option value="">Все переписки</option>{conversations.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Автор<select value={author} onChange={e=>setAuthor(e.target.value)}><option value="">Все авторы</option>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label>С даты<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
          <label>По дату<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
          {!!filterCount&&<Button className="text-button search-reset" onClick={()=>{setChatId("");setAuthor("");setFrom("");setTo("");}}>Сбросить фильтры</Button>}
        </div>
      </details>
      {!!filterCount&&<div className="search-active-filters" aria-label="Активные фильтры">
        {chatId&&<Button onClick={()=>setChatId("")} aria-label="Снять фильтр переписки">{conversations.find(c=>c.id===chatId)?.name??"Переписка"}<X size={13}/></Button>}
        {author&&<Button onClick={()=>setAuthor("")} aria-label="Снять фильтр автора">{users.find(u=>u.id===author)?.name??"Автор"}<X size={13}/></Button>}
        {(from||to)&&<Button onClick={()=>{setFrom("");setTo("");}} aria-label="Снять фильтр дат">{from||"Начало"} — {to||"Сегодня"}<X size={13}/></Button>}
      </div>}
    </header>
    <div className="chat-rows search-results" aria-busy={busy}>
      {query.trim().length<2&&<p className="search-hint">Поиск по всем доступным перепискам. Введите хотя бы два символа.</p>}{error&&<p role="alert" className="search-hint">{error}</p>}
      {!!results.people.length&&<><h2 className="search-section">Люди</h2>{results.people.map(u=><Button className="chat-row search-person" key={u.id} onClick={()=>openPerson(u.id)}><Avatar name={u.name} image={u.image}/><span>{u.name}</span></Button>)}</>}
      {!!results.chats.length&&<><h2 className="search-section">Чаты</h2>{results.chats.map(c=><Button className="chat-row search-conversation" key={c.id} onClick={()=>openChat(c.id)}><Avatar name={c.name} image={chats.find(chat=>chat.id===c.id)?.avatar}/><span>{c.name}</span></Button>)}</>}
      {!!results.messages.length&&<div className="search-section search-message-heading"><h2>Сообщения</h2><span>{chatId?conversations.find(c=>c.id===chatId)?.name:"Из всех чатов"}</span></div>}
      {results.messages.map(m=><Button className="search-message" key={m.id} onClick={()=>openMessage(m)}>
        <span className="search-result-avatar"><Avatar name={m.chatName} image={chats.find(c=>c.id===m.chatId)?.avatar}/></span>
        <span className="search-result-copy"><strong>{m.chatName}</strong><small>{m.authorName}</small><span className="search-excerpt">{highlight(excerpt(m.text,query),query)}</span></span>
        <time className="search-result-date" dateTime={m.createdAt} title={new Date(m.createdAt).toLocaleString("ru-RU")}>{chatDate(m.createdAt)}</time>
      </Button>)}
      {busy&&<p className="search-hint" role="status">Ищем…</p>}{!busy&&!error&&query.trim().length>=2&&!results.people.length&&!results.chats.length&&!results.messages.length&&<p className="search-hint">Ничего не найдено</p>}{results.next&&<Button className="text-button search-more" disabled={busy} onClick={()=>void more()}>Ещё сообщения</Button>}
    </div>
  </section>;
}
function highlight(text:string,query:string){
  const word=query.toLowerCase().replaceAll("ё","е").match(/[\p{L}\p{N}]+/u)?.[0];
  if(!word)return text;
  const index=text.toLowerCase().replaceAll("ё","е").indexOf(word);
  return index<0?text:<>{text.slice(0,index)}<mark>{text.slice(index,index+word.length)}</mark>{text.slice(index+word.length)}</>;
}

function excerpt(text:string,query:string){const word=query.toLowerCase().replaceAll("ё","е").match(/[\p{L}\p{N}]+/u)?.[0]??"";const index=text.toLowerCase().replaceAll("ё","е").indexOf(word);const start=Math.max(0,index-50);return `${start?"…":""}${text.slice(start,start+220)}${text.length>start+220?"…":""}`;}
