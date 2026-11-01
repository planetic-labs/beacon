import {useEffect,useRef,useState} from 'react';
import type {Room,Track} from 'livekit-client';
import {Phone,PhoneOff,Video,Mic,MicOff,VideoOff,Volume2} from 'lucide-react';
import {api,ApiError,Dialog} from './ui';
import {Button} from './app-button';
import '../calls.css';
const clientId=crypto.randomUUID();
function callApi(path:string,method='GET',data?:unknown){return api(path,method,data,true,{'X-Beacon-Call-Client':clientId});}
type Call={id:string;chatId:string;callerId:string;mode:'audio'|'video';status:'ringing'|'active';participants:{id:string;name:string;image?:string}[]};
export function startPersonalCall(chatId:string,mode:'audio'|'video'){window.dispatchEvent(new CustomEvent('beacon:start-call',{detail:{chatId,mode}}));}
export function Calls({userId,notify}:{userId:string;notify:(error:unknown)=>void}){
 const [call,setCall]=useState<Call|null>(null),[busy,setBusy]=useState(false);
 const current=useRef(call);current.current=call;
 const report=useRef(notify);report.current=notify;
 const refresh=useRef<()=>Promise<void>>(async()=>{});
 useEffect(()=>{
  let alive=true,inFlight=false,again=false;
  refresh.current=async()=>{if(!alive)return;if(inFlight){again=true;return;}inFlight=true;try{const state=await callApi('calls');if(alive)setCall(state.call??null);}catch{/* Reconnect/poll retries silently. */}finally{inFlight=false;if(again&&alive){again=false;void refresh.current();}}};
  void refresh.current();const sync=()=>void refresh.current();
  const start=(event:Event)=>{setBusy(true);void callApi('calls','POST',(event as CustomEvent).detail).then(()=>refresh.current()).catch(error=>report.current(error)).finally(()=>{if(alive)setBusy(false);});};
  const timer=setInterval(sync,15000),heartbeat=setInterval(()=>{const c=current.current;if(c?.status==='active')void callApi(`calls/${c.id}/heartbeat`,'POST',{}).catch(()=>{});},10000);
  window.addEventListener('beacon:calls-changed',sync);document.addEventListener('visibilitychange',sync);window.addEventListener('beacon:start-call',start);
  return()=>{alive=false;clearInterval(timer);clearInterval(heartbeat);window.removeEventListener('beacon:calls-changed',sync);document.removeEventListener('visibilitychange',sync);window.removeEventListener('beacon:start-call',start);};
 },[userId]);
 async function act(action:string){if(!call||busy)return;setBusy(true);try{await callApi(`calls/${call.id}/${action}`,'POST',{});await refresh.current();}catch(error){if(!(action==='accept'&&error instanceof ApiError&&error.status===409))report.current(error);await refresh.current();}finally{setBusy(false);}}
 if(!call)return null;
 const incoming=call.callerId!==userId,peer=call.participants.find(p=>p.id!==userId);
 return <Dialog title={call.mode==='video'?'Видеозвонок':'Аудиозвонок'} close={()=>void act('end')} className="call-dialog">
  <div className="call-peer"><strong>{peer?.name??'Собеседник'}</strong><p role="status">{call.status==='ringing'?(incoming?'Входящий звонок':'Вызываем собеседника…'):'Разговор'}</p></div>
  {call.status==='active'?<CallSession key={call.id} call={call} userId={userId} end={()=>void act('end')} notify={error=>report.current(error)}/>:<div className="call-controls">
   {incoming&&<Button disabled={busy} className="call-accept" onClick={()=>void act('accept')}><Phone/>Принять</Button>}
   <Button disabled={busy} className="call-end" onClick={()=>void act(incoming?'decline':'end')}><PhoneOff/>{incoming?'Отклонить':'Отменить'}</Button>
  </div>}
 </Dialog>;
}
function CallSession({call,userId,end,notify}:{call:Call;userId:string;end:()=>void;notify:(error:unknown)=>void}){
 const media=useRef<HTMLDivElement>(null),room=useRef<Room|null>(null);
 const [state,setState]=useState('Подключение…'),[mic,setMic]=useState(true),[camera,setCamera]=useState(call.mode==='video'),[needsAudio,setNeedsAudio]=useState(false),[busy,setBusy]=useState(false);
 const callbacks=useRef({end,notify});callbacks.current={end,notify};
 useEffect(()=>{
  let alive=true;const attached=new Map<Track,HTMLElement>();
  const attach=(track:Track,local=false)=>{if(!media.current||attached.has(track))return;const element=track.attach();if(local&&element instanceof HTMLMediaElement)element.muted=true;if(local&&element instanceof HTMLVideoElement)element.classList.add('call-local-preview');element.setAttribute('aria-label',local?'Вы':'Собеседник');media.current.appendChild(element);attached.set(track,element);};
  const detach=(track:Track)=>{const element=attached.get(track);if(element){track.detach(element as HTMLMediaElement);element.remove();attached.delete(track);}};
  void (async()=>{
   try{
    const {Room,RoomEvent,Track}=await import('livekit-client');if(!alive)return;
    const session=new Room({adaptiveStream:true,dynacast:true});room.current=session;
    session.on(RoomEvent.TrackSubscribed,track=>attach(track));session.on(RoomEvent.TrackUnsubscribed,detach);
    session.on(RoomEvent.LocalTrackPublished,p=>{if(p.track?.kind===Track.Kind.Video)attach(p.track,true);});session.on(RoomEvent.LocalTrackUnpublished,p=>{if(p.track)detach(p.track);});
    session.on(RoomEvent.AudioPlaybackStatusChanged,()=>{if(alive)setNeedsAudio(!session.canPlaybackAudio);});
    session.on(RoomEvent.Reconnecting,()=>{if(alive)setState('Восстанавливаем соединение…');});session.on(RoomEvent.Reconnected,()=>{if(alive)setState('Соединение установлено');});
    session.on(RoomEvent.Disconnected,()=>{if(alive)setState('Соединение прервано. Завершите звонок и попробуйте снова.');});
    const credentials=await callApi(`calls/${call.id}/join`,'POST',{});if(!alive)return;
    await session.connect(credentials.url,credentials.token);if(!alive){await session.disconnect();return;}
    const microphone=await session.localParticipant.setMicrophoneEnabled(true);
    if(!alive){microphone?.track?.stop();await session.disconnect();return;}
    if(call.mode==='video'){
     const camera=await session.localParticipant.setCameraEnabled(true,{resolution:{width:640,height:360,frameRate:24}});
     if(!alive){camera?.track?.stop();await session.disconnect();return;}
    }
    if(alive){setNeedsAudio(!session.canPlaybackAudio);setState('Соединение установлено');}
   }catch{if(alive){callbacks.current.notify(new Error('Не удалось начать разговор. Проверьте доступ к микрофону/камере и соединение.'));callbacks.current.end();}}
  })();
  return()=>{alive=false;for(const track of attached.keys())detach(track);void room.current?.disconnect();room.current=null;};
 },[call.id,userId]);
 async function toggle(kind:'mic'|'camera'){if(!room.current||busy)return;setBusy(true);try{if(kind==='mic'){await room.current.localParticipant.setMicrophoneEnabled(!mic);setMic(!mic);}else{await room.current.localParticipant.setCameraEnabled(!camera);setCamera(!camera);}}catch{notify(new Error('Не удалось переключить устройство'));}finally{setBusy(false);}}
 return <><p className="call-state" role="status">{state}</p><div className="call-media" ref={media}/>
  {needsAudio&&<Button className="text-button" onClick={()=>void room.current?.startAudio().catch(()=>notify(new Error('Разрешите воспроизведение звука')))}><Volume2/>Включить звук</Button>}
  <div className="call-controls"><Button disabled={busy} aria-pressed={!mic} aria-label={mic?'Выключить микрофон':'Включить микрофон'} onClick={()=>void toggle('mic')}>{mic?<Mic/>:<MicOff/>}</Button>
  {call.mode==='video'&&<Button disabled={busy} aria-pressed={!camera} aria-label={camera?'Выключить камеру':'Включить камеру'} onClick={()=>void toggle('camera')}>{camera?<Video/>:<VideoOff/>}</Button>}
  <Button className="call-end" onClick={()=>{void room.current?.disconnect();end();}}><PhoneOff/>Завершить</Button></div>
 </>;
}
