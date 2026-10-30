import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckSquare, Eye, Forward, Heart, MoreHorizontal, Pencil, Pin, PinOff, Reply, Trash2 } from "lucide-react";
import "../message-actions.css";

type Props = {
  id: string; className: string; enabled: boolean; pinned: boolean;
  reply: () => void; edit?: () => void; forward: () => void; read?: () => void;
  pin: () => void; select: () => void; remove?: () => void;
  reaction: () => void; quickReaction: (emoji: string) => void;
  children: ReactNode;
};
export function MessageActions(props: Props) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const popup = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({x:0,y:0});
  const cancelHold = () => { if(hold.current)clearTimeout(hold.current); hold.current=null; };
  useEffect(()=>()=>cancelHold(),[]);
  const latest = useRef(props); latest.current = props;
  const close = (restoreFocus = false) => { setPoint(null); if (restoreFocus) trigger.current?.focus({ preventScroll: true }); };
  function open(x: number, y: number) {
    window.dispatchEvent(new CustomEvent("beacon:message-menu", { detail: props.id }));
    setPoint({ x, y });
  }
  useEffect(() => { if (!props.enabled) setPoint(null); }, [props.enabled]);
  useLayoutEffect(() => {
    if (!point || !popup.current) return;
    const bounds = popup.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(point.x, innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(point.y, innerHeight - bounds.height - 8)) });
    popup.current.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [point]);
  useEffect(() => {
    if (!point) return;
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(); };
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) close(); };
    const resize = () => { const bounds=popup.current?.getBoundingClientRect(); if(bounds)setPosition({left:Math.max(8,Math.min(point.x,innerWidth-bounds.width-8)),top:Math.max(8,Math.min(point.y,innerHeight-bounds.height-8))}); };
    const another = (event: Event) => { if ((event as CustomEvent).detail !== latest.current.id) close(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
      if (event.key === "Tab") { close(true); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = [...(popup.current?.querySelectorAll<HTMLElement>('[role="menuitem"], .message-quick-reactions button') ?? [])];
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener("pointerdown", outside, true); document.addEventListener("scroll", scroll, true);
    document.addEventListener("keydown", key, true); window.addEventListener("resize", resize); window.addEventListener("beacon:message-menu", another);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("scroll", scroll, true); document.removeEventListener("keydown", key, true); window.removeEventListener("resize", resize); window.removeEventListener("beacon:message-menu", another); };
  }, [point]);
  const actions = [
    { label: "Ответить", icon: Reply, action: props.reply },
    ...(props.edit ? [{ label: "Изменить", icon: Pencil, action: props.edit }] : []),
    { label: "Переслать", icon: Forward, action: props.forward },
    { label: "Поставить реакцию", icon: Heart, action: props.reaction },
    ...(props.read ? [{ label: "Кто прочитал", icon: Eye, action: props.read }] : []),
    { label: props.pinned ? "Открепить сообщение" : "Закрепить сообщение", icon: props.pinned ? PinOff : Pin, action: props.pin },
    { label: "Выбрать это сообщение", icon: CheckSquare, action: props.select },
    ...(props.remove ? [{ label: "Удалить", icon: Trash2, action: props.remove, danger: true }] : []),
  ];
  return <div data-message-id={props.id} className={props.className}
    onPointerDown={event=>{if(event.pointerType!=="touch"||!props.enabled)return;cancelHold();origin.current={x:event.clientX,y:event.clientY};hold.current=setTimeout(()=>{hold.current=null;open(origin.current.x,origin.current.y);},500);}}
    onPointerMove={event=>{if(Math.hypot(event.clientX-origin.current.x,event.clientY-origin.current.y)>10)cancelHold();}}
    onPointerUp={cancelHold} onPointerCancel={cancelHold}
    onContextMenu={event => {
    if (!props.enabled) return;
    event.preventDefault(); event.stopPropagation(); open(event.clientX, event.clientY);
  }}>
    {props.children}
    {props.enabled && <div className="message-hover-tools" data-open={!!point}>
      <button type="button" className="message-shortcut" aria-label={props.edit ? "Редактировать сообщение" : "Ответить на сообщение"} data-tooltip={props.edit ? "Изменить" : "Ответить"} onClick={props.edit ?? props.reply}>{props.edit ? <Pencil /> : <Reply />}</button>
      <button type="button" ref={trigger} aria-label="Действия с сообщением" aria-haspopup="menu" aria-expanded={!!point} onClick={event => {
        if (point) { close(); return; }
        const rect = event.currentTarget.getBoundingClientRect(); open(rect.right - 260, rect.bottom + 6);
      }}><MoreHorizontal /></button>
    </div>}
    {point && props.enabled && createPortal(<div ref={popup} className="message-action-popup" style={position} onContextMenu={event => {event.preventDefault();event.stopPropagation();}}>
      <div className="message-quick-reactions" role="group" aria-label="Быстрые реакции">
        {["🔥", "❤️", "😂", "👍", "😢"].map(emoji => <button type="button" key={emoji} aria-label={`Реакция ${emoji}`} onClick={() => { close(); props.quickReaction(emoji); }}>{emoji}</button>)}
      </div>
      <div role="menu" aria-label="Действия с сообщением">
        {actions.map(({ label, icon: Glyph, action, ...rest }) => <button type="button" role="menuitem" key={label} className={"danger" in rest && rest.danger ? "danger" : ""} onClick={() => { close(true); action(); }}><Glyph /><span>{label}</span></button>)}
      </div>
    </div>, document.body)}
  </div>;
}
