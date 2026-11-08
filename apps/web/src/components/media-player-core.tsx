import { useState, useRef, useEffect, useCallback } from "react";
import { Video, VideoPlayer, VideoSkin } from "@videojs/react/video";
import { Audio, AudioPlayer, AudioSkin } from "@videojs/react/audio";
import "@videojs/react/video/skin.css";
import "@videojs/react/audio/skin.css";
import { usePlaybackPolicy, type MediaPlayerProps, type PlaybackEvent } from "./media-player";

export default function MediaPlayerCore({ src, title, kind = "video", poster, pauseWhenHidden = false, startAt, seek, hideDownload=false, onPlaybackEvent }: MediaPlayerProps) {
  const [failed,setFailed]=useState(false);
  const play=usePlaybackPolicy(pauseWhenHidden);
  const element=useRef<HTMLMediaElement|null>(null),started=useRef(false),desired=useRef(startAt??0),cleanup=useRef<()=>void>(()=>{});
  const latest=useRef({play,onPlaybackEvent});latest.current={play,onPlaybackEvent};
  useEffect(()=>{if(!started.current)desired.current=startAt??0;},[startAt]);
  useEffect(()=>{if(seek){desired.current=seek.seconds;const media=element.current;if(media&&media.readyState>=1)media.currentTime=Math.min(Math.max(0,seek.seconds),Math.max(0,media.duration-0.05));}},[seek]);
  // Attach at the native ref, before Video.js registers its own media adapter.
  // This also covers metadata arriving from cache before React effects run.
  const bind=useCallback((media:HTMLMediaElement|null)=>{
    cleanup.current();element.current=media;if(!media)return;
    const controller=new AbortController();cleanup.current=()=>controller.abort();
    const report=(type:PlaybackEvent['type'])=>latest.current.onPlaybackEvent?.({type,position:media.currentTime,duration:Number.isFinite(media.duration)?media.duration:0,playbackRate:media.playbackRate});
    const ready=()=>{if(!started.current){started.current=true;if(desired.current>0&&Number.isFinite(media.duration))media.currentTime=Math.min(desired.current,Math.max(0,media.duration-0.05));}};
    media.addEventListener('loadedmetadata',ready,{signal:controller.signal});
    for(const type of ['play','pause','timeupdate','seeking','seeked','ended','ratechange'] as const)media.addEventListener(type,()=>{if(type==='play')latest.current.play({currentTarget:media});report(type);},{signal:controller.signal});
    media.addEventListener('error',()=>setFailed(true),{signal:controller.signal});
    if(media.readyState>=1)ready();
  },[]);
  const attributes={src,'aria-label':title,preload:startAt!==undefined?'metadata' as const:'none' as const,controlsList:hideDownload?'nodownload':undefined,mediaRef:bind};
  return <>
    {kind === "audio" ? <AudioPlayer key={src}><AudioSkin><Audio {...attributes} /></AudioSkin></AudioPlayer>
      : <VideoPlayer key={src}><VideoSkin style={{ width: "100%", aspectRatio: "16 / 9" }}><Video {...attributes} poster={poster} playsInline /></VideoSkin></VideoPlayer>}
    {failed&&<p className="media-error" role="alert">{hideDownload?'Не удалось воспроизвести видео. Проверьте соединение или повторите попытку.':'Не удалось воспроизвести файл. Проверьте соединение или скачайте его для просмотра.'}</p>}
  </>;
}
