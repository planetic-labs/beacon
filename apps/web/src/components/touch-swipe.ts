import {useEffect,useRef,type RefObject} from "react";
type Options={
 enabled:boolean;scope?:string;direction:"left"|"both";
 target:(element:Element)=>HTMLElement|null;
 swipe:(direction:"left"|"right",element:HTMLElement)=>void;
 progress?:(distance:number,element:HTMLElement,active:boolean)=>void;
};
// One delegated touch listener per surface. Native vertical/edge gestures stay untouched;
// Aria continues to own buttons, focus and long-press selection.
export function useTouchSwipe(ref:RefObject<HTMLElement|null>,options:Options){
 const latest=useRef(options);latest.current=options;
 useEffect(()=>{
  const surface=ref.current;if(!options.enabled||!surface)return;
  let gesture:{id:number;x:number;y:number;dx:number;dy:number;horizontal:boolean;element:HTMLElement;pressTarget:Element;pointerId?:number}|null=null;
  let suppressUntil=0;
  let pointerId:number|undefined;
  let pressStart:{x:number;y:number}|null=null;
  const pointerDown=(event:PointerEvent)=>{pointerId=event.pointerType==="touch"?event.pointerId:undefined;pressStart=pointerId===undefined?null:{x:event.clientX,y:event.clientY};};
  const reset=()=>{if(gesture)latest.current.progress?.(0,gesture.element,false);gesture=null;};
  const start=(event:TouchEvent)=>{
   reset();if(!latest.current.enabled||event.touches.length!==1)return;
   const touch=event.touches[0];
   if(touch.clientX<24||touch.clientX>innerWidth-24||window.getSelection()?.isCollapsed===false||!(event.target instanceof Element))return;
   const element=latest.current.target(event.target);if(!element)return;
   gesture={id:touch.identifier,x:touch.clientX,y:touch.clientY,dx:0,dy:0,horizontal:false,element,pressTarget:event.target,pointerId};
  };
  const move=(event:TouchEvent)=>{
   if(!gesture)return;
   if(!latest.current.enabled||event.touches.length!==1){reset();return;}
   const touch=event.touches[0];if(touch.identifier!==gesture.id){reset();return;}
   gesture.dx=touch.clientX-gesture.x;gesture.dy=touch.clientY-gesture.y;
   const x=Math.abs(gesture.dx),y=Math.abs(gesture.dy);
   if(!gesture.horizontal){
    if(y>8&&y>=x){reset();return;}
    if(x<12||x<y*1.5)return;
    if(latest.current.direction==="left"&&gesture.dx>0){reset();return;}
    gesture.horizontal=true;
    // Cancel Aria's press/long-press recognizer when this becomes a swipe.
    suppressUntil=performance.now()+700;
    latest.current.progress?.(gesture.dx,gesture.element,true);
    if(gesture.pointerId!==undefined)gesture.pressTarget.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:gesture.pointerId,pointerType:"touch"}));
   }
   if(!event.cancelable){reset();return;}
   event.preventDefault();suppressUntil=performance.now()+700;
   latest.current.progress?.(gesture.dx,gesture.element,true);
  };
  const end=(event:TouchEvent)=>{
   if(!gesture)return;
   const current=gesture;
   const completed=event.touches.length===0&&[...event.changedTouches].some(touch=>touch.identifier===current.id);
   reset();
   if(current.horizontal)suppressUntil=performance.now()+700;
   else if(Math.abs(current.dx)<10&&Math.abs(current.dy)<10)suppressUntil=0;
   if(completed&&latest.current.enabled&&current.horizontal&&Math.abs(current.dx)>=56&&Math.abs(current.dx)>=Math.abs(current.dy)*1.5){
    const direction=current.dx<0?"left":"right";
    if(direction==="left"||latest.current.direction==="both")latest.current.swipe(direction,current.element);
   }
  };
  const cancel=()=>reset();
  const click=(event:MouseEvent)=>{if(performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}};
  const pointerUp=(event:PointerEvent)=>{
   const start=pressStart;pressStart=null;
   if(start&&!gesture?.horizontal&&Math.abs(event.clientX-start.x)<10&&Math.abs(event.clientY-start.y)<10)suppressUntil=0;
  };
  const keyboard=()=>{suppressUntil=0;};
  surface.addEventListener("pointerdown",pointerDown,true);surface.addEventListener("keydown",keyboard,true);surface.addEventListener("pointerup",pointerUp,true);
  surface.addEventListener("touchstart",start,{passive:true});surface.addEventListener("touchmove",move,{passive:false});
  surface.addEventListener("touchend",end);surface.addEventListener("touchcancel",cancel);surface.addEventListener("click",click,true);
  return()=>{reset();surface.removeEventListener("pointerdown",pointerDown,true);surface.removeEventListener("keydown",keyboard,true);surface.removeEventListener("pointerup",pointerUp,true);surface.removeEventListener("touchstart",start);surface.removeEventListener("touchmove",move);surface.removeEventListener("touchend",end);surface.removeEventListener("touchcancel",cancel);surface.removeEventListener("click",click,true);};
 },[ref,options.enabled,options.scope]);
}
