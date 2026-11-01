import { Button } from "./app-button";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import type { Socket } from "socket.io-client";
import type { PhotoAlbum } from "@beacon/shared";
import { api, Dialog } from "./ui";
import { Icon } from "./icon";
export type PhotoTarget={chatId:string;messageId:string;index:number};
const bounded=(value:number)=>Math.max(1,Math.min(5,value));
export function PhotoViewer({target,socket,close}:{target:PhotoTarget;socket:RefObject<Socket|null>;close:()=>void}) {
 const [album,setAlbum]=useState<PhotoAlbum|null>(null),[index,setIndex]=useState(target.index),[busy,setBusy]=useState(true),[error,setError]=useState("");
 const [zoom,setZoom]=useState(1),[pan,setPan]=useState({x:0,y:0}),[loaded,setLoaded]=useState(false),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 const navigating=useRef(false);
 const imageRef=useRef<HTMLImageElement>(null);
 const stage=useRef<HTMLDivElement>(null),generation=useRef(0),currentId=useRef(target.messageId),albumRef=useRef(album),indexRef=useRef(index),zoomRef=useRef(zoom),panRef=useRef(pan);
 const pinched=useRef(false);
 const pointers=useRef(new Map<number,{x:number;y:number}>()),gesture=useRef({x:0,y:0,panX:0,panY:0,distance:0,zoom:1});
 albumRef.current=album;indexRef.current=index;zoomRef.current=zoom;panRef.current=pan;
 async function load(messageId:string,position:number,background=false){
  if(background&&navigating.current)return;
  const version=++generation.current;currentId.current=messageId;if(!background){navigating.current=true;setBusy(true);}setError("");
  try{const result=await api<PhotoAlbum>(`chats/${target.chatId}/photos/${messageId}`);if(version!==generation.current)return;setAlbum(result);setIndex(position<0?result.files.length-1:Math.min(position,result.files.length-1));}
  catch(e){if(version===generation.current){setAlbum(null);setError(e instanceof Error?e.message:String(e));}}
  finally{if(version===generation.current){navigating.current=false;setBusy(false);}}
 }
 const actions=useRef({navigate:(_direction:number)=>{}});
 function navigate(direction:number){
  if(busy||!album)return;
  const next=index+direction;
  if(next>=0&&next<album.files.length)setIndex(next);
  else{const other=direction<0?album.previousMessageId:album.nextMessageId;if(other)void load(other,direction<0?-1:0);}
 }
 actions.current={navigate};
 useEffect(()=>{
  void load(target.messageId,target.index);
  const changed=({chatId}:{chatId:string})=>{if(chatId===target.chatId)void load(currentId.current,indexRef.current,true);};
  const refresh=()=>{void load(currentId.current,indexRef.current,true);};
  const s=socket.current;s?.on("chat.changed",changed);s?.on("connect",refresh);
  return()=>{generation.current++;s?.off("chat.changed",changed);s?.off("connect",refresh);};
 },[target.chatId,target.messageId]);
 const file=album?.files[index];
 useLayoutEffect(()=>{setZoom(1);setPan({x:0,y:0});setLoaded(Boolean(imageRef.current?.complete&&imageRef.current.naturalWidth));setFailed(false);pointers.current.clear();},[file?.id]);
 useEffect(()=>{if(zoom===1)setPan({x:0,y:0});},[zoom]);
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();actions.current.navigate(event.key==="ArrowLeft"?-1:1);}
   else if(event.key==="+"||event.key==="="){event.preventDefault();setZoom(value=>bounded(value+0.5));}
   else if(event.key==="-"){event.preventDefault();setZoom(value=>bounded(value-0.5));}
  };
  const wheel=(event:WheelEvent)=>{event.preventDefault();setZoom(value=>bounded(value*(event.deltaY<0?1.15:1/1.15)));};
  document.addEventListener("keydown",key);const node=stage.current;node?.addEventListener("wheel",wheel,{passive:false});
  return()=>{document.removeEventListener("keydown",key);node?.removeEventListener("wheel",wheel);};
 },[]);
 function clampPan(x:number,y:number){const node=stage.current;const maxX=(node?.clientWidth??0)*(zoomRef.current-1)/2,maxY=(node?.clientHeight??0)*(zoomRef.current-1)/2;return {x:Math.max(-maxX,Math.min(maxX,x)),y:Math.max(-maxY,Math.min(maxY,y))};}
 function down(event:PointerEvent<HTMLDivElement>){
  event.currentTarget.setPointerCapture(event.pointerId);pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
  const points=[...pointers.current.values()];if(points.length===1)pinched.current=false;if(points.length===2)pinched.current=true;gesture.current={x:event.clientX,y:event.clientY,panX:panRef.current.x,panY:panRef.current.y,distance:points.length===2?Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y):0,zoom:zoomRef.current};
 }
 function move(event:PointerEvent<HTMLDivElement>){
  if(!pointers.current.has(event.pointerId))return;pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});const points=[...pointers.current.values()],g=gesture.current;
  if(points.length===2&&g.distance){setZoom(bounded(g.zoom*Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)/g.distance));}
  else if(points.length===1&&zoomRef.current>1)setPan(clampPan(g.panX+event.clientX-g.x,g.panY+event.clientY-g.y));
 }
 function up(event:PointerEvent<HTMLDivElement>){
  const count=pointers.current.size,g=gesture.current;pointers.current.delete(event.pointerId);
  if(count===1&&!pinched.current&&zoomRef.current===1){const dx=event.clientX-g.x,dy=event.clientY-g.y;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.2)navigate(dx<0?1:-1);}
  if(pointers.current.size===1){const point=[...pointers.current.values()][0];gesture.current={x:point.x,y:point.y,panX:panRef.current.x,panY:panRef.current.y,distance:0,zoom:zoomRef.current};}
  if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
 }
 return <Dialog title="Просмотр фото" className="photo-dialog" close={close}>
  <div className="photo-toolbar"><Button className="icon-button" aria-label="Предыдущее фото" disabled={busy||!album||(index===0&&!album.previousMessageId)} onClick={()=>navigate(-1)}><Icon name="back"/></Button><span>{album?`${index+1} / ${album.files.length}`:"Фото"}</span><Button className="icon-button" aria-label="Следующее фото" disabled={busy||!album||(index===album.files.length-1&&!album.nextMessageId)} onClick={()=>navigate(1)}><Icon name="next"/></Button><span className="photo-toolbar-spacer"/><Button className="icon-button" aria-label="Уменьшить фото" disabled={zoom<=1} onClick={()=>setZoom(value=>bounded(value-0.5))}>−</Button><Button className="text-button" aria-label="Сбросить масштаб" onClick={()=>setZoom(1)}>{Math.round(zoom*100)}%</Button><Button className="icon-button" aria-label="Увеличить фото" disabled={zoom>=5} onClick={()=>setZoom(value=>bounded(value+0.5))}>+</Button>{file&&<a className="icon-button" href={`/media/${file.id}?download=1`} download aria-label="Скачать фото"><Icon name="download"/></a>}</div>
  <div ref={stage} className={`photo-stage ${zoom>1?"zoomed":""}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={event=>{pointers.current.delete(event.pointerId);}} onDoubleClick={()=>setZoom(value=>value>1?1:2)}>
   {busy&&<span className="photo-view-status" role="status">Загружаем…</span>}{error&&<p className="photo-view-status" role="alert">{error}</p>}
   {file&&!error&&<img ref={imageRef} key={`${file.id}:${retry}`} src={`/media/${file.id}`} alt={`Фото ${index+1}`} draggable={false} className={failed?"photo-failed":""} style={{transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`}} onLoad={()=>setLoaded(true)} onError={()=>{setFailed(true);setLoaded(true);}}/>}
   {!busy&&file&&!loaded&&<span className="photo-view-status" role="status">Загружаем фото…</span>}{failed&&<div className="photo-view-status"><p>Не удалось загрузить фото</p><Button className="text-button" onPointerDown={e=>e.stopPropagation()} onClick={()=>{setFailed(false);setLoaded(false);setRetry(n=>n+1);}}>Повторить</Button></div>}
  </div>
  {album&&<div className="photo-caption"><strong>{album.authorName}</strong><small>{new Date(album.createdAt).toLocaleString("ru")}</small>{album.text&&<p>{album.text}</p>}</div>}
 </Dialog>;
}
