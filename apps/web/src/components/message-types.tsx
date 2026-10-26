import { useRef, useState, type ReactNode } from "react";
import { Icon } from "./icon";
type Renderer = (content: Record<string, unknown>) => ReactNode;
// A new content type registers its renderer here and its validator/preview in
// packages/shared/src/messages.ts. Membership, delivery and reactions remain shared.
const renderers: Record<string, Renderer> = {
  audio: content => <audio className="message-audio" controls preload="metadata" src={`/media/${content.fileId}`} aria-label="Голосовое сообщение" />,
  circle: content => <CirclePlayer src={`/media/${content.fileId}`} duration={Number(content.duration ?? 0)} />,
  sticker: (content) => <img className="message-sticker" src={`/media/${content.fileId}`} alt={String(content.text || "Стикер")} loading="lazy" />,
  photo: (content) => {
    const ids = Array.isArray(content.fileIds) ? content.fileIds as string[] : [String(content.fileId)];
    return <><span className={`message-photos ${ids.length > 1 ? "multiple" : ""}`}>{ids.map((id, index) => <a key={id} href={`/media/${id}`} target="_blank" rel="noopener noreferrer" aria-label={`Открыть фото ${index + 1}`}><img className="message-photo" src={`/media/${id}`} alt={`Фото ${index + 1}`} loading="lazy" /></a>)}</span>{content.text ? <span>{String(content.text)}</span> : null}</>;
  },
  text: (content) => String(content.text ?? ""),
};
export function renderMessage(type: string, content: Record<string, unknown>) {
  return (
    renderers[type]?.(content) ?? "Этот тип сообщения пока не поддерживается"
  );
}

export function CirclePlayer({ src, duration = 0 }: { src: string; duration?: number }) {
  const video = useRef<HTMLVideoElement>(null);
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
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onTimeUpdate={() => setTime(video.current?.currentTime ?? 0)} onLoadedMetadata={() => { const value = video.current?.duration; if (value && Number.isFinite(value)) setLength(value); }} onError={() => setFailed(true)} />
    <button type="button" className="circle-play" aria-label={playing ? "Приостановить видеокружок" : "Воспроизвести видеокружок"} onClick={() => void toggle()}><Icon name={playing ? "pause" : "play"} /></button>
    <input className="circle-seek" type="range" aria-label="Перемотка видеокружка" min={0} max={length || 1} step={0.1} value={Math.min(time, length || 1)} onChange={event => { if (video.current) video.current.currentTime = Number(event.target.value); }} />
    {failed && <span className="circle-error">Не удалось воспроизвести</span>}
  </span>;
}
