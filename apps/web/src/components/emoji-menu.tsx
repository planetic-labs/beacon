import { useEffect, useRef, useState, type ComponentType } from "react";
import { Dialog } from "./ui";
type Props={userId:string;choose:(emoji:string)=>void};
export function EmojiMenu({userId,choose,close}:{userId:string;choose:(emoji:string)=>void;close:()=>void}){
  const closeRef=useRef(close);closeRef.current=close;
  useEffect(()=>{
    // The picker consumes Escape at window capture; register before it loads.
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();event.stopImmediatePropagation();closeRef.current();}};
    window.addEventListener("keydown",escape,true);return()=>window.removeEventListener("keydown",escape,true);
  },[]);
  const [Picker,setPicker]=useState<ComponentType<Props>|null>(null),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let live=true;setFailed(false);
    void import("./emoji-picker").then(module=>{if(live)setPicker(()=>module.default);}).catch(()=>{if(live)setFailed(true);});
    return()=>{live=false;};
  },[attempt]);
  return <Dialog title="Эмодзи" className="emoji-dialog" close={close}>
    <div className="emoji-menu-body">
      {Picker?<Picker key={userId} userId={userId} choose={choose}/>:failed?<div className="emoji-menu-status" role="alert"><p>Не удалось загрузить эмодзи</p><button type="button" className="secondary-button" onClick={()=>setAttempt(n=>n+1)}>Повторить</button></div>:<p className="emoji-menu-status" role="status">Загружаем эмодзи…</p>}
    </div>
  </Dialog>;
}
