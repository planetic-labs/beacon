import {useRef,type ReactNode} from "react";
import {useLongPress} from "react-aria/useLongPress";
import {useMobileInteractions} from "./interaction-context";
import {Button} from "./app-button";
export function SelectableChatRow({id,selected,selecting,disabled,className,open,toggle,selectNew,children}:{id?:string;selected:boolean;selecting:boolean;disabled?:boolean;className:string;open:()=>void;toggle:(id:string)=>void;selectNew?:()=>void;children:ReactNode}){
 const mobile=useMobileInteractions(),held=useRef(false),root=useRef<HTMLDivElement>(null);
 const choose=()=>id?toggle(id):selectNew?.();
 const chooseHeld=()=>{if(held.current)return;held.current=true;choose();};
 const {longPressProps}=useLongPress({pointerType:"touch",isDisabled:(!id&&!selectNew)||disabled||!mobile,onLongPress:chooseHeld});
 return <div {...longPressProps} ref={root} className="chat-row-gesture" onKeyDownCapture={event=>{held.current=false;if((id||selectNew)&&event.key==="Enter"&&event.shiftKey){event.preventDefault();event.stopPropagation();choose();}}} onPointerDownCapture={()=>{held.current=false;}} onClickCapture={event=>{if(held.current){event.preventDefault();event.stopPropagation();}}} onContextMenu={event=>{if((id||selectNew)&&!disabled){event.preventDefault();chooseHeld();}}}>
  <Button className={`${className} ${selected?"chat-row-selected":""}`} disabled={disabled||(selecting&&!id&&!selectNew)} aria-pressed={selecting?selected:undefined} aria-keyshortcuts={id||selectNew?"Shift+Enter":undefined} onClick={()=>selecting?choose():open()}>{children}</Button>
 </div>;
}
