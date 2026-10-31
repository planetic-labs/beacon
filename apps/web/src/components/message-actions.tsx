import { useMobileInteractions } from "./interaction-context";
import { FocusScope } from "react-aria/FocusScope";
import { useLongPress } from "react-aria/useLongPress";
import { useOverlay } from "react-aria/useOverlay";
import { Menu, MenuItem } from "react-aria-components";
import { useContextMenu } from "react-aria/useContextMenu";
import { Button } from "./app-button";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Copy, Forward, MoreHorizontal, Pencil, Pin, PinOff, Reply, Trash2 } from "lucide-react";
import "../message-actions.css";

type Props = {
  id: string; className: string; enabled: boolean; pinned: boolean; selecting?:boolean; textual?:boolean;
  reply: () => void; copy?: () => void; edit?: () => void; forward: () => void;
  pin: () => void; select: () => void; remove?: () => void;
  reaction: () => void; quickReaction: (emoji: string) => void;
  children: ReactNode;
};
export function MessageActions(props: Props) {
  const mobile=useMobileInteractions();
  const held=useRef(false),holdAllowed=useRef(true),touchGesture=useRef(false);
  const interactive=(target:EventTarget|null)=>target instanceof Element&&!!target.closest("button,a,input,textarea,select,video,audio,[role=button],[contenteditable=true]");
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const root=useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{left:number;top:number;maxHeight?:number}>({ left: 0, top: 0 });
  const latest = useRef(props); latest.current = props;
  const close = (_restoreFocus = false) => setPoint(null);
  function open(x: number, y: number) {
    window.dispatchEvent(new CustomEvent("beacon:message-menu", { detail: props.id }));
    root.current?.focus({preventScroll:true});
    setPoint({ x, y });
  }
  useEffect(() => { if (!props.enabled) setPoint(null); }, [props.enabled]);
  useLayoutEffect(() => {
    if (!point || !popup.current) return;
    const viewport=window.visualViewport;
    const place=()=>{
      const bounds=popup.current?.getBoundingClientRect();if(!bounds)return;
      const x=viewport?.offsetLeft??0,y=viewport?.offsetTop??0;
      const width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
      const maxHeight=Math.max(0,height-16);
      const next={left:Math.max(x+8,Math.min(point.x,x+width-bounds.width-8)),top:Math.max(y+8,Math.min(point.y,y+height-Math.min(bounds.height,maxHeight)-8)),maxHeight};
      setPosition(previous=>previous.left===next.left&&previous.top===next.top&&previous.maxHeight===next.maxHeight?previous:next);
    };
    // Aria's collection and fonts may change the menu height after its first render.
    const observer=new ResizeObserver(place);observer.observe(popup.current);place();
    window.addEventListener('resize',place);viewport?.addEventListener('resize',place);viewport?.addEventListener('scroll',place);
    return()=>{observer.disconnect();window.removeEventListener('resize',place);viewport?.removeEventListener('resize',place);viewport?.removeEventListener('scroll',place);};
  }, [point]);
  useEffect(() => {
    if (!point) return;
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) close(); };
    const another = (event: Event) => { if ((event as CustomEvent).detail !== latest.current.id) close(); };
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("beacon:message-menu", another);
    return () => { document.removeEventListener("scroll", scroll, true); window.removeEventListener("beacon:message-menu", another); };
  }, [point]);
  const {overlayProps}=useOverlay({isOpen:!!point,isDismissable:true,onClose:()=>close(true)},popup);
  const actions = [
    { label: "Ответить", icon: Reply, action: props.reply },
    ...(props.copy ? [{ label: "Копировать", icon: Copy, action: props.copy }] : []),
    { label: "Переслать", icon: Forward, action: props.forward },
    { label: props.pinned ? "Открепить сообщение" : "Закрепить сообщение", icon: props.pinned ? PinOff : Pin, action: props.pin },
    ...(props.edit ? [{ label: "Изменить", icon: Pencil, action: props.edit }] : []),
    ...(props.remove ? [{ label: "Удалить", icon: Trash2, action: props.remove, danger: true }] : []),
  ];
  const contextAt=(x:number,y:number)=>{if(!props.enabled)return;const bounds=root.current?.getBoundingClientRect();open(x+(bounds?.left??0),y+(bounds?.top??0));};
  const {contextMenuProps}=useContextMenu({onContextMenu:event=>contextAt(event.x,event.y)});
  const {longPressProps}=useLongPress({isDisabled:!props.enabled||!mobile,pointerType:"touch",onLongPress:()=>{if(!holdAllowed.current||root.current?.hasAttribute("data-swipe-claimed"))return;held.current=true;close();props.select();}});
  return <div {...(props.enabled?(mobile?longPressProps:contextMenuProps):{})}
    onPointerDownCapture={event=>{if(root.current)delete root.current.dataset.swipeClaimed;held.current=false;touchGesture.current=event.pointerType==='touch';holdAllowed.current=!interactive(event.target)||(event.target instanceof Element&&!!event.target.closest(".message-photo-open"));}}
    onClickCapture={event=>{if(mobile&&(held.current||root.current?.hasAttribute("data-swipe-claimed"))){held.current=false;event.preventDefault();event.stopPropagation();}}}
    onClick={event=>{
      if(!mobile||interactive(event.target)||popup.current?.contains(event.target as Node))return;
      if(props.selecting){props.select();return;}
      if(props.enabled&&(props.textual||!(event.target as Element).closest('.bubble')))open(event.clientX,event.clientY);
    }}
    onContextMenu={mobile?event=>{event.preventDefault();const source=event.nativeEvent as MouseEvent&{pointerType?:string};if(!touchGesture.current&&source.pointerType!=='touch'&&!held.current&&props.enabled)open(event.clientX,event.clientY);}:contextMenuProps.onContextMenu}
    ref={root} onKeyDownCapture={event=>{if(point&&(event.key==="Escape"||event.key==="Tab")){event.preventDefault();event.stopPropagation();close(true);}}} tabIndex={props.enabled?0:undefined} data-message-id={props.id} className={props.className}>
    {props.children}
    {props.enabled && !mobile && <div className="message-hover-tools" data-open={!!point}>
      <Button type="button" className="message-shortcut" aria-label={props.edit ? "Редактировать сообщение" : "Ответить на сообщение"} data-tooltip={props.edit ? "Изменить" : "Ответить"} onClick={props.edit ?? props.reply}>{props.edit ? <Pencil /> : <Reply />}</Button>
      <Button type="button" ref={trigger} aria-label="Действия с сообщением" aria-haspopup="menu" aria-expanded={!!point} onClick={event => {
        if (point) { close(); return; }
        const rect = event.currentTarget.getBoundingClientRect(); open(rect.right - 260, rect.bottom + 6);
      }}><MoreHorizontal /></Button>
    </div>}
    {point && props.enabled && createPortal(<FocusScope contain restoreFocus>{mobile&&<div className="message-menu-backdrop" aria-hidden="true" onPointerDown={()=>close()}/>}<div {...overlayProps} ref={popup} className="message-action-popup" style={position} onContextMenu={event => {event.preventDefault();event.stopPropagation();}}>
      <div className="message-quick-reactions" role="group" aria-label="Быстрые реакции">
        {["🔥", "❤️", "😂", "👍", "😢"].map(emoji => <Button type="button" key={emoji} aria-label={`Реакция ${emoji}`} onClick={() => { close(); props.quickReaction(emoji); }}>{emoji}</Button>)}
        <Button type="button" aria-label="Больше реакций" onClick={()=>{close();props.reaction();}}><MoreHorizontal /></Button>
      </div>
      <Menu autoFocus="first" aria-label="Действия с сообщением" onAction={key=>{close(true);actions.find(item=>item.label===key)?.action();}}>
        {actions.map(({ label, icon: Glyph, action, ...rest }) => <MenuItem id={label} textValue={label} key={label} className={"danger" in rest && rest.danger ? "danger" : ""} ><Glyph /><span>{label}</span></MenuItem>)}
      </Menu>
    </div></FocusScope>, document.body)}
  </div>;
}
