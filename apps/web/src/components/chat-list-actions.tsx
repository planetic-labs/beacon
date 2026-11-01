import {useState} from "react";
import type {Chat,ChatFolder} from "@beacon/shared";
import {Bell,BellOff,Pin,PinOff,FolderPlus,Trash2,X,Check} from "lucide-react";
import {Button} from "./app-button";
import {Dialog,api} from "./ui";
export function ChatSelectionBadge(){return <span className="chat-selection-check" aria-hidden="true"><Check size={12}/></span>;}
export function ChatListActions({chats,folders,cancel,refresh,notify}:{chats:Chat[];folders:ChatFolder[];cancel:()=>void;refresh:(action:string)=>Promise<void>;notify:(error:unknown)=>void}){
 const [busy,setBusy]=useState(false),[dialog,setDialog]=useState<"folder"|"delete"|null>(null);
 const allMuted=!!chats.length&&chats.every(chat=>chat.muted),allPinned=!!chats.length&&chats.every(chat=>chat.pinned);
 async function apply(action:string,folderId?:string){if(busy||!chats.length)return;setBusy(true);try{await api("chats/selection","POST",{chatIds:chats.map(chat=>chat.id),action,folderId});await refresh(action);setDialog(null);cancel();}catch(error){notify(error);}finally{setBusy(false);}}
 return <><div className="chat-list-selection-toolbar" role="toolbar" aria-label="Действия с выбранными чатами" aria-busy={busy}>
  <Button className="icon-button" aria-label="Отменить выбор чатов" disabled={busy} onClick={cancel}><X/></Button><span className="chat-list-selection-count" aria-label={`Выбрано чатов: ${chats.length}`}>{chats.length}</span>
  <Button className="icon-button" aria-label={allMuted?"Включить уведомления":"Выключить уведомления"} data-tooltip={allMuted?"Включить уведомления":"Выключить уведомления"} disabled={busy||!chats.length} onClick={()=>void apply(allMuted?"unmute":"mute")}>{allMuted?<Bell/>:<BellOff/>}</Button>
  <Button className="icon-button" aria-label={allPinned?"Открепить чаты":"Закрепить чаты"} data-tooltip={allPinned?"Открепить чаты":"Закрепить чаты"} disabled={busy||!chats.length} onClick={()=>void apply(allPinned?"unpin":"pin")}>{allPinned?<PinOff/>:<Pin/>}</Button>
  <Button className="icon-button" aria-label="Добавить в папку" data-tooltip="Добавить в папку" disabled={busy||!chats.length} onClick={()=>setDialog("folder")}><FolderPlus/></Button>
  <Button className="icon-button danger" aria-label="Удалить мои сообщения" data-tooltip="Удалить мои сообщения" disabled={busy||!chats.length} onClick={()=>setDialog("delete")}><Trash2/></Button>
 </div>
 {dialog==="folder"&&<Dialog title="Добавить чаты в папку" close={()=>{if(!busy)setDialog(null);}}><div className="chat-folder-destinations">{folders.map(folder=><Button className="secondary-button" key={folder.id} disabled={busy} onClick={()=>void apply("folder",folder.id)}>{folder.name}</Button>)}</div>{!folders.length&&<p>Сначала создайте папку в настройках: «Папки чатов».</p>}</Dialog>}
 {dialog==="delete"&&<Dialog title="Удалить мои сообщения?" close={()=>{if(!busy)setDialog(null);}}><p>Из выбранных переписок ({chats.length}) будут удалены все ваши сообщения у всех участников. Сообщения других пользователей и сами чаты сохранятся. Отменить удаление нельзя.</p><div className="inline-actions"><Button className="primary-button" disabled={busy} onClick={()=>void apply("delete-own")}>{busy?"Удаляем…":"Удалить мои сообщения"}</Button><Button className="secondary-button" disabled={busy} onClick={()=>setDialog(null)}>Отмена</Button></div></Dialog>}
 </>;
}
