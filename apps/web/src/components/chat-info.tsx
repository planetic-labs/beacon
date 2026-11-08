import {useEffect,useState,useRef,type RefObject} from 'react';
import type {Socket} from 'socket.io-client';
import type {Chat,User} from '@beacon/shared';
import {ArrowLeft,MessageCircle,Bell,BellOff,Phone,Video,Settings} from 'lucide-react';
import {Avatar,api,OverlayDialog} from './ui';
import {Button} from './app-button';
import {ChatAttachments} from './chat-attachments';
import {pushApi} from './push-settings';
import {startPersonalCall} from './calls';
import type {PhotoTarget} from './photo-viewer';
import '../chat-info.css';
export function ChatInfo({chat,meId,status,inline=false,socket,close,photo,jump,manage,person,refresh,notify}:{chat:Chat;inline?:boolean;meId:string;status:string;socket:RefObject<Socket|null>;close:()=>void;photo:(target:PhotoTarget)=>void;jump:(id:string)=>void;manage:()=>void;person:(id:string)=>void;refresh:()=>Promise<void>;notify:(error:unknown)=>void}){
 const panel=useRef<HTMLElement>(null);
 useEffect(()=>{if(inline)panel.current?.focus({preventScroll:true});},[inline]);
 const [members,setMembers]=useState<User[]>([]),[description,setDescription]=useState(chat.description??''),[loading,setLoading]=useState(chat.kind==='group'),[error,setError]=useState(''),[muted,setMuted]=useState(!!chat.muted),[busy,setBusy]=useState(false);
 useEffect(()=>{if(chat.kind!=='group')return;let live=true;void api<{chat:{description?:string};members:User[]}>(`chats/${chat.id}/members`).then(result=>{if(live){setMembers(result.members);setDescription(result.chat.description??'');}}).catch(error=>{if(live)setError(error instanceof Error?error.message:String(error));}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[chat.id,chat.kind]);
 async function toggleSound(){if(busy)return;setBusy(true);try{await pushApi(`/chats/${chat.id}`,'PATCH',{muted:!muted});setMuted(!muted);await refresh();}catch(error){notify(error);}finally{setBusy(false);}}
 const label=chat.kind==='group'?'Информация о группе':'Профиль собеседника';
 const content=<>
  <header className="chat-info-header"><Button className="icon-button" aria-label="Вернуться в чат" onClick={close}><ArrowLeft/></Button>{chat.kind==='group'&&<Button className="icon-button" aria-label="Участники и настройки группы" onClick={()=>{close();manage();}}><Settings/></Button>}</header>
  <div className="chat-info-body">
   <section className="chat-info-identity"><Avatar name={chat.name} image={chat.avatar}/><h1>{chat.name}</h1><p>{chat.kind==='group'?(loading?'Загружаем участников…':`Участников: ${members.length}`):status}</p></section>
   <nav className="chat-info-actions" aria-label="Действия с перепиской">
    <Button onClick={close}><MessageCircle/><span>Чат</span></Button>
    <Button disabled={busy} onClick={()=>void toggleSound()} aria-label={muted?'Включить звук':'Выключить звук'}>{muted?<BellOff/>:<Bell/>}<span>{muted?'Без звука':'Звук'}</span></Button>
    {chat.kind==='direct'&&<><Button onClick={()=>{close();startPersonalCall(chat.id,'audio');}}><Phone/><span>Звонок</span></Button><Button onClick={()=>{close();startPersonalCall(chat.id,'video');}}><Video/><span>Видео</span></Button></>}
   </nav>
   {description&&<section className="chat-info-card"><h2>Описание группы</h2><p>{description}</p></section>}
   {chat.kind==='group'&&<section className="chat-info-card"><h2>Участники</h2>{error&&<p role="alert">{error}</p>}{members.map(user=><Button key={user.id} className="chat-info-member" disabled={user.id===meId} onClick={()=>{close();person(user.id);}} aria-label={`Открыть переписку: ${user.name}`}><Avatar name={user.name} image={user.image}/><span>{user.name}</span></Button>)}</section>}
   <section className="chat-info-attachments" aria-label="Вложения переписки"><ChatAttachments embedded chatId={chat.id} name={chat.name} socket={socket} close={close} photo={photo} jump={jump}/></section>
  </div>
 </>;
 return inline?<section ref={panel} tabIndex={-1} className="chat-info chat-info-inline" aria-label={label}>{content}</section>:<OverlayDialog title={label} close={close} className="chat-info" backdropClassName="chat-info-backdrop">{content}</OverlayDialog>;
}
