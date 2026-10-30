import { lazy, Suspense, useEffect, useRef } from "react";
import type { SyntheticEvent } from "react";
import "../media-player.css";

const Player = lazy(() => import("./media-player-core"));
export type PlaybackEvent = {
  type: "play" | "pause" | "timeupdate" | "seeking" | "seeked" | "ended" | "ratechange";
  position: number;
  duration: number;
  playbackRate: number;
};
export type MediaPlayerProps = {
  src: string;
  title: string;
  kind?: "video" | "audio";
  className?: string;
  poster?: string;
  pauseWhenHidden?: boolean;
  onPlaybackEvent?: (event: PlaybackEvent) => void;
};
// Shared across materials, chat, and future storage previews. Only one local
// media element plays at a time, including the existing circular video UI.
const playing = new Set<HTMLMediaElement>();
export function usePlaybackPolicy(pauseWhenHidden = false) {
  const owned = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    const hidden = () => { if (pauseWhenHidden && document.hidden) owned.current?.pause(); };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      if (owned.current) { owned.current.pause(); playing.delete(owned.current); }
    };
  }, [pauseWhenHidden]);
  return (event: SyntheticEvent<HTMLMediaElement>) => {
    const media = event.currentTarget;
    owned.current = media;
    for (const other of playing) if (other !== media) { other.pause(); playing.delete(other); }
    playing.add(media);
    if (pauseWhenHidden && document.hidden) media.pause();
  };
}
export function MediaPlayer(props: MediaPlayerProps) {
  return <div className={`beacon-media ${props.kind === "audio" ? "is-audio" : "is-video"} ${props.className ?? ""}`}>
    <Suspense fallback={<div className="media-loading" role="status">Загружаем плеер…</div>}><Player key={props.src} {...props} /></Suspense>
  </div>;
}
