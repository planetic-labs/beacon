import { useState, type SyntheticEvent } from "react";
import { Video, VideoPlayer, VideoSkin } from "@videojs/react/video";
import { Audio, AudioPlayer, AudioSkin } from "@videojs/react/audio";
import "@videojs/react/video/skin.css";
import "@videojs/react/audio/skin.css";
import { usePlaybackPolicy, type MediaPlayerProps, type PlaybackEvent } from "./media-player";

export default function MediaPlayerCore({ src, title, kind = "video", poster, pauseWhenHidden = false, onPlaybackEvent }: MediaPlayerProps) {
  const [failed, setFailed] = useState(false);
  const play = usePlaybackPolicy(pauseWhenHidden);
  function report(type: PlaybackEvent["type"], event: SyntheticEvent<HTMLMediaElement>) {
    const media = event.currentTarget;
    onPlaybackEvent?.({ type, position: media.currentTime, duration: Number.isFinite(media.duration) ? media.duration : 0, playbackRate: media.playbackRate });
  }
  const events = {
    src, "aria-label": title, preload: "none" as const,
    onPlay: (event: SyntheticEvent<HTMLMediaElement>) => { play(event); report("play", event); },
    onPause: (event: SyntheticEvent<HTMLMediaElement>) => report("pause", event),
    onTimeUpdate: (event: SyntheticEvent<HTMLMediaElement>) => report("timeupdate", event),
    onSeeking: (event: SyntheticEvent<HTMLMediaElement>) => report("seeking", event),
    onSeeked: (event: SyntheticEvent<HTMLMediaElement>) => report("seeked", event),
    onEnded: (event: SyntheticEvent<HTMLMediaElement>) => report("ended", event),
    onRateChange: (event: SyntheticEvent<HTMLMediaElement>) => report("ratechange", event),
    onError: () => setFailed(true),
  };
  return <>
    {kind === "audio" ? <AudioPlayer key={src}><AudioSkin><Audio {...events} /></AudioSkin></AudioPlayer>
      : <VideoPlayer key={src}><VideoSkin style={{ width: "100%", aspectRatio: "16 / 9" }}><Video {...events} poster={poster} playsInline /></VideoSkin></VideoPlayer>}
    {failed && <p className="media-error" role="alert">Не удалось воспроизвести файл. Проверьте соединение или скачайте его для просмотра.</p>}
  </>;
}
