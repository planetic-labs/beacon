import {useCallback,useEffect,useRef,useState,type RefObject} from "react";
import type {Socket} from "socket.io-client";
import type {Chat,ChatFolder} from "@beacon/shared";
import {Form,Tabs,TabList,Tab} from "react-aria-components";
import {Button} from "./app-button";
import {api,Dialog,Field} from "./ui";
import {localAccount,readCache,writeCache} from "../offline";
import "../chat-folders.css";
export function useChatFolders(userId:string|undefined,socket:RefObject<Socket|null>,notify:(error:unknown)=>void){
 const [folders,setFolders]=useState<ChatFolder[]>([]),[active,setActive]=useState("all");
 const report=useRef(notify);report.current=notify;
 const refresh=useCallback(async()=>{
  if(!userId)return;
  const value=await api<ChatFolder[]>("chat-folders");
  if(localAccount()!==userId||!Array.isArray(value))return;
  setFolders(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);
  await writeCache("chat-folders",value,userId);
 },[userId]);
 useEffect(()=>{
  setFolders([]);setActive("all");if(!userId)return;
  let live=true;
  void readCache<ChatFolder[]>("chat-folders").then(value=>{if(live&&localAccount()===userId&&Array.isArray(value))setFolders(value);}).then(()=>{if(live)return refresh();}).catch(error=>{if(live&&navigator.onLine)report.current(error);});
  const sync=()=>void refresh().catch(error=>{if(live&&navigator.onLine)report.current(error);});
  const visible=()=>{if(!document.hidden)sync();};
  const current=socket.current;current?.on("connect",sync);current?.on("sync",sync);current?.on("folders.changed",sync);
  window.addEventListener("online",sync);window.addEventListener("focus",sync);document.addEventListener("visibilitychange",visible);
  return()=>{live=false;current?.off("connect",sync);current?.off("sync",sync);current?.off("folders.changed",sync);window.removeEventListener("online",sync);window.removeEventListener("focus",sync);document.removeEventListener("visibilitychange",visible);};
 },[userId,socket,refresh]);
 useEffect(()=>{if(active!=="all"&&!folders.some(folder=>folder.id===active))setActive("all");},[folders,active]);
 return {folders,active,setActive,refresh};
}
export function FolderTabs({folders,active,choose,chats}:{folders:ChatFolder[];active:string;choose:(id:string)=>void;chats:Chat[]}){
 const unread=(folder?:ChatFolder)=>chats.filter(chat=>chat.kind!=="saved"&&(!folder||folder.chatIds.includes(chat.id))).reduce((n,chat)=>n+(chat.unread>0?1:0),0);
 return <Tabs selectedKey={active} onSelectionChange={key=>choose(String(key))} className="chat-folder-tabs"><TabList aria-label="Папки чатов"><Tab id="all">Все чаты{unread()>0&&<span>{unread()}</span>}</Tab>{folders.map(folder=><Tab key={folder.id} id={folder.id}>{folder.name}{unread(folder)>0&&<span>{unread(folder)}</span>}</Tab>)}</TabList></Tabs>;
}
export function FolderSettings({folders,chats,refresh,notify}:{folders:ChatFolder[];chats:Chat[];refresh:()=>Promise<void>;notify:(error:unknown)=>void}){
 const [editing,setEditing]=useState<ChatFolder|null>(null),[deleting,setDeleting]=useState<ChatFolder|null>(null),[busy,setBusy]=useState(false);
 const [name,setName]=useState(""),[ids,setIds]=useState<string[]>([]);
 const edit=(folder:ChatFolder)=>{setName(folder.name);setIds(folder.chatIds);setEditing(folder);};
 const selectable=chats.filter(chat=>chat.kind!=="saved");
 async function save(){if(!editing||busy)return;setBusy(true);try{await api(`chat-folders${editing.id?`/${editing.id}`:""}`,editing.id?"PATCH":"POST",{name,chatIds:ids.filter(id=>selectable.some(chat=>chat.id===id))});await refresh();setEditing(null);}catch(error){notify(error);}finally{setBusy(false);}}
 async function remove(){if(!deleting||busy)return;setBusy(true);try{await api(`chat-folders/${deleting.id}`,"DELETE");await refresh();setDeleting(null);}catch(error){notify(error);}finally{setBusy(false);}}
 return <section className="folder-settings"><p className="field-note">Папки видны только вам и синхронизируются между устройствами. Переписку можно добавить в несколько папок. «Все чаты» всегда показывает общий список.</p>
  <Button className="primary-button" disabled={folders.length>=20} onClick={()=>edit({id:"",name:"",chatIds:[]})}>Создать папку</Button>
  <div className="folder-settings-list">{folders.map(folder=><div key={folder.id}><strong>{folder.name}</strong><span>{folder.chatIds.length} переписок</span><Button className="text-button" onClick={()=>edit(folder)}>Изменить</Button><Button className="text-button danger" onClick={()=>setDeleting(folder)}>Удалить</Button></div>)}</div>
  {!folders.length&&<p className="field-note">Папок пока нет. Например, можно создать «Личные» или «Сообщество».</p>}
  {editing&&<Dialog title={editing.id?"Изменить папку":"Новая папка"} close={()=>{if(!busy)setEditing(null);}}><Form onSubmit={event=>{event.preventDefault();void save();}}>
   <Field label="Название папки"><input value={name} maxLength={60} required onChange={event=>setName(event.target.value)}/></Field>
   <fieldset className="folder-chat-picker"><legend>Переписки в папке</legend>{selectable.map(chat=><label key={chat.id}><input type="checkbox" checked={ids.includes(chat.id)} onChange={event=>setIds(previous=>event.target.checked?[...previous,chat.id]:previous.filter(id=>id!==chat.id))}/><span>{chat.name}</span></label>)}{!selectable.length&&<p>Сначала начните переписку или создайте групповой чат.</p>}</fieldset>
   <div className="inline-actions"><Button type="submit" className="primary-button" disabled={busy||!name.trim()}>{busy?"Сохраняем…":"Сохранить"}</Button><Button type="button" className="secondary-button" disabled={busy} onClick={()=>setEditing(null)}>Отмена</Button></div>
  </Form></Dialog>}
  {deleting&&<Dialog title="Удалить папку?" close={()=>{if(!busy)setDeleting(null);}}><p>Папка «{deleting.name}» будет удалена. Переписки и сообщения сохранятся.</p><div className="inline-actions"><Button className="primary-button" disabled={busy} onClick={()=>void remove()}>Удалить папку</Button><Button className="secondary-button" disabled={busy} onClick={()=>setDeleting(null)}>Отмена</Button></div></Dialog>}
 </section>;
}
