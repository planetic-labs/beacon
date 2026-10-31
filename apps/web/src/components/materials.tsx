import { Button } from "./app-button";
import { useState } from "react";
import { ArrowLeft, ChevronRight, Clapperboard, Grid2X2, Library, ListVideo, Menu, Play, Plus, Search, X } from "lucide-react";
import "../materials.css";
import { MediaPlayer } from "./media-player";
import { Dialog } from "./ui";

// Demonstration catalogue; the flower clip is locally hosted CC0 media.
const playlists = [
  { id: "meetings", name: "Дикая природа", color: "#8299ba" },
  { id: "practice", name: "Мир океана", color: "#82a496" },
  { id: "beacon", name: "Планета Земля", color: "#b095ba" },
  { id: "short", name: "Экспедиции", color: "#c4a17f" },
];
export const videos = [
  { id: "ideas", title: "Серенгети: великая миграция", playlist: "meetings", cover: "Сердце саванны", duration: "32:18", date: "Сегодня", theme: "indigo", progress: 36 },
  { id: "focus", title: "Тайная жизнь кораллового рифа", playlist: "practice", cover: "Под водой", duration: "18:42", date: "Сегодня", theme: "sage", progress: 0 },
  { id: "first", title: "Леса, которые меняют климат", playlist: "beacon", cover: "Дыхание леса", duration: "08:15", date: "Вчера", theme: "lilac", progress: 62 },
  { id: "questions", title: "Снежный барс: по следам горного призрака", playlist: "meetings", cover: "Выше облаков", duration: "46:07", date: "Вчера", theme: "sand", progress: 0 },
  { id: "notes", title: "Путешествие к северному сиянию", playlist: "short", cover: "Свет Арктики", duration: "05:24", date: "На этой неделе", theme: "rose", progress: 0 },
  { id: "workshop", title: "Киты: голоса из глубины", playlist: "practice", cover: "Голоса океана", duration: "27:36", date: "На этой неделе", theme: "blue", progress: 0 },
  { id: "tools", title: "Жизнь на краю пустыни", playlist: "beacon", cover: "Мир песков", duration: "11:09", date: "На этой неделе", theme: "indigo", progress: 0 },
  { id: "pause", title: "Камчатка: земля вулканов", playlist: "short", cover: "Сила Земли", duration: "04:50", date: "На этой неделе", theme: "sage", progress: 0 },
];
type Video = typeof videos[number];
const demo: Video = { id: "flower", title: "Цветы крупным планом · тест плеера", playlist: "beacon", cover: "Мир в деталях", duration: "00:05", date: "Тестовое видео · CC0", theme: "sage", progress: 0 };
videos.unshift(demo);
export function VideoCard({ video, compact = false, open }: { video: Video; compact?: boolean; open: () => void }) {
  const playlist = playlists.find(item => item.id === video.playlist)!;
  return <article className={`mv-video ${compact ? "compact" : ""}`}>
    <Button type="button" className={`mv-cover ${video.theme}`} disabled={video.id !== demo.id} onClick={open} aria-label={`Смотреть «${video.title}»${video.id !== demo.id ? " — появится позже" : ""}`}>
      <span className="mv-cover-category">{playlist.name}</span>
      <span className="mv-cover-shape" aria-hidden="true" />
      <span className="mv-cover-title">{video.cover}</span>
      <span className="mv-cover-play"><Play size={17} fill="currentColor" /></span>
      <span className="mv-duration">{video.duration}</span>
      {video.progress > 0 && <span className="mv-progress" aria-hidden="true"><span style={{width:`${video.progress}%`}} /></span>}
    </Button>
    <div className="mv-video-info"><h3>{video.title}</h3><p>{playlist.name}</p><span>{compact ? `Просмотрено ${video.progress}%` : video.date}</span></div>
  </article>;
}
export function Materials({ back }: { back: () => void }) {
  const [watching, setWatching] = useState(false);
  const [view, setView] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const playlist = playlists.find(item => item.id === view);
  const visible = playlist ? videos.filter(video => video.playlist === playlist.id) : videos;
  function select(value: string) { setView(value); setMenuOpen(false); }
  return <>
    {watching && <Dialog title={demo.title} className="material-player-dialog" close={() => setWatching(false)}><MediaPlayer src="/demo/flower.mp4" title={demo.title} pauseWhenHidden /><p className="material-player-note">Короткое тестовое видео MDN (CC0). При скрытии приложения воспроизведение останавливается.</p></Dialog>}
    {menuOpen && <Button type="button" className="mv-backdrop" aria-label="Закрыть меню материалов" onClick={() => setMenuOpen(false)} />}
    <aside className={`mv-sidebar ${menuOpen ? "open" : ""}`} aria-label="Меню материалов" onKeyDown={event => { if(event.key === "Escape") setMenuOpen(false); }}>
      <header className="mv-brand"><span><Library size={21} /></span><h1>Материалы</h1><Button type="button" className="mv-mobile-close mv-icon-button" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)}><X size={20} /></Button></header>
      <nav className="mv-navigation" aria-label="Разделы материалов">
        <Button type="button" className={view === "overview" ? "active" : ""} aria-current={view === "overview" ? "page" : undefined} onClick={() => select("overview")}><Grid2X2 size={19} />Обзор</Button>
        <Button type="button" className={view === "all" ? "active" : ""} aria-current={view === "all" ? "page" : undefined} onClick={() => select("all")}><Clapperboard size={19} />Все видео<span className="mv-count">{videos.length}</span></Button>
      </nav>
      <div className="mv-playlist-label"><h2>Плейлисты</h2><Button type="button" className="mv-icon-button" aria-label="Создать плейлист" title="Появится позже" disabled><Plus size={17} /></Button></div>
      <nav className="mv-playlists" aria-label="Плейлисты">
        {playlists.map(item => <Button type="button" key={item.id} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => select(item.id)}><span className="mv-playlist-icon" style={{background:item.color}}><ListVideo size={19} /></span><span className="mv-playlist-name">{item.name}<small>{videos.filter(video => video.playlist === item.id).length} видео</small></span></Button>)}
      </nav>
      <p className="mv-demo-note">Демонстрационные материалы</p>
    </aside>
    <main className="mv-main">
      <header className="mv-topbar">
        <Button type="button" className="mv-mobile-back mv-icon-button" aria-label="Назад к чатам" onClick={back}><ArrowLeft size={20} /></Button>
        <Button type="button" className="mv-menu-toggle mv-icon-button" aria-label="Открыть меню материалов" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></Button>
        <div className="mv-search"><Search size={18} /><input type="search" aria-label="Поиск по материалам" placeholder="Найти видео или плейлист" disabled /></div>
        <Button type="button" className="mv-add" disabled title="Появится позже"><Plus size={18} /><span>Добавить материал</span></Button>
      </header>
      <div className="mv-content">
        <div className="mv-heading"><div>{playlist && <span className="mv-eyebrow">Плейлист</span>}<h2>{playlist?.name ?? (view === "all" ? "Все видео" : "Материалы")}</h2><p>{playlist ? `${visible.length} видео · Демонстрационный плейлист` : "Документальные истории о природе, животных и нашей планете"}</p></div><span className="mv-preview-label">Макет</span></div>
        {view === "overview" && <section className="mv-continue" aria-label="Продолжить просмотр"><div className="mv-section-heading"><h2>Продолжить просмотр</h2></div><div className="mv-continue-grid">{videos.filter(video => video.progress > 0).map(video => <VideoCard key={video.id} video={video} compact open={() => setWatching(true)} />)}</div></section>}
        <section aria-label={playlist?.name ?? "Видео"}>
          <div className="mv-section-heading"><h2>{playlist ? "Видео в плейлисте" : view === "all" ? "Медиатека" : "Свежие материалы"}</h2>{view === "overview" && <Button type="button" onClick={() => select("all")}>Все видео<ChevronRight size={16} /></Button>}</div>
          <div className="mv-video-grid">{visible.map(video => <VideoCard key={video.id} video={video} open={() => setWatching(true)} />)}</div>
        </section>
      </div>
    </main>
  </>;
}
