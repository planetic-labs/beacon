import { MentionText } from "./chat-features";
import { fileSize, type Mention } from "@beacon/shared";
import { useRef, useState, type ReactNode } from "react";
import { Icon } from "./icon";
import { MediaPlayer, usePlaybackPolicy } from "./media-player";
type Renderer = (content: Record<string, unknown>, text: ReactNode, photo?: (index:number)=>void) => ReactNode;
// A new content type registers its renderer here and its validator/preview in
// packages/shared/src/messages.ts. Membership, delivery and reactions remain shared.
const renderers: Record<string, Renderer> = {
  deleted: () => <span className="deleted-message">Сообщение удалено</span>,
  file: (content,text,photo) => <FileMessage content={content} caption={text} photo={photo}/>,
  video: (content,text) => <>{String(content.mime).startsWith("video/")&&<MediaPlayer className="message-video" src={`/media/${content.fileId}`} title={String(content.name??"Видео")} />}<FileMessage content={content} caption={text}/></>,
  audio: content => <MediaPlayer kind="audio" className="message-audio" src={`/media/${content.fileId}`} title="Голосовое сообщение" />,
  circle: content => <CirclePlayer src={`/media/${content.fileId}`} duration={Number(content.duration ?? 0)} />,
  sticker: (content) => <img className="message-sticker" src={`/media/${content.fileId}`} alt={String(content.text || "Стикер")} loading="lazy" />,
  photo: (content, text, photo) => {
    const ids = Array.isArray(content.fileIds) ? content.fileIds as string[] : [String(content.fileId)];
    return <><span className={`message-photos ${ids.length > 1 ? "multiple" : ""}`}>{ids.map((id, index) => <button type="button" className="message-photo-open" key={id} onClick={()=>photo?.(index)} aria-label={`Открыть фото ${index + 1}`}><img className="message-photo" src={`/media/${id}?thumbnail=1`} alt={`Фото ${index + 1}`} loading="lazy" /></button>)}</span>{content.text ? <span>{text}</span> : null}</>;
  },
  text: (_content, text) => text,
};
export function renderMessage(type: string, content: Record<string, unknown>, userId?:string, open?:(id:string)=>void, photo?:(index:number)=>void) {
  if(!navigator.onLine&&!["text","deleted"].includes(type)) {
    const labels:Record<string,string>={photo:"Фото",video:"Видео",file:"Файл",audio:"Голосовое сообщение",circle:"Видеокружок",sticker:"Стикер"};
    return <span>{content.text?`${String(content.text)} · `:""}{labels[type]??"Вложение"} доступно с интернетом</span>;
  }
  return (
    renderers[type]?.(content, <MentionText text={String(content.text??"")} mentions={content.mentions as Mention[]|undefined} userId={userId} open={open}/>, photo) ?? "Этот тип сообщения пока не поддерживается"
  );
}

export function CirclePlayer({ src, duration = 0 }: { src: string; duration?: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const exclusivePlay = usePlaybackPolicy();
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(duration);
  const [failed, setFailed] = useState(false);
  async function toggle() {
    if (!video.current) return;
    if (video.current.paused) { try { await video.current.play(); } catch { setFailed(true); } }
    else video.current.pause();
  }
  return <span className={`circle-player ${playing ? "playing" : ""}`}>
    <video ref={video} className="message-circle" src={src} playsInline preload="metadata" aria-label="Видеокружок"
      onPlay={event => { exclusivePlay(event); setPlaying(true); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onTimeUpdate={() => setTime(video.current?.currentTime ?? 0)} onLoadedMetadata={() => { const value = video.current?.duration; if (value && Number.isFinite(value)) setLength(value); }} onError={() => setFailed(true)} />
    <button type="button" className="circle-play" aria-label={playing ? "Приостановить видеокружок" : "Воспроизвести видеокружок"} onClick={() => void toggle()}><Icon name={playing ? "pause" : "play"} /></button>
    <input className="circle-seek" type="range" aria-label="Перемотка видеокружка" min={0} max={length || 1} step={0.1} value={Math.min(time, length || 1)} onChange={event => { if (video.current) video.current.currentTime = Number(event.target.value); }} />
    {failed && <span className="circle-error">Не удалось воспроизвести</span>}
  </span>;
}

function FileMessage({content,caption,photo}:{content:Record<string,unknown>;caption:ReactNode;photo?:(index:number)=>void}) {
  const [failed,setFailed]=useState(false);
  const image=["image/jpeg","image/png","image/webp"].includes(String(content.mime));
  return <span className="message-file">{image&&!failed&&<button type="button" className="message-photo-open" aria-label="Открыть фото" onClick={()=>photo?.(0)}><img className="message-photo" src={`/media/${content.fileId}?thumbnail=1`} alt={String(content.name??"Фото")} loading="lazy" onError={()=>setFailed(true)}/></button>}<a href={`/media/${content.fileId}?download=1`} download><Icon name="file"/><span><strong>{String(content.name??"Файл")}</strong><small>{fileSize(Number(content.size??0))} · Скачать</small></span></a>{content.text?<span>{caption}</span>:null}</span>;
}
