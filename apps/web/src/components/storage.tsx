import { useState } from "react";
import { ArrowLeft, Clock3, Folder, FolderPlus, HardDrive, Menu, Search, Star, Trash2, Upload, X } from "lucide-react";
import "../storage.css";

// Layout adapted from the local Storage Space frontend. No storage API is connected.
const sections = [
  { id: "all", title: "Все файлы", icon: Folder },
  { id: "recent", title: "Недавние", icon: Clock3 },
  { id: "favorites", title: "Избранное", icon: Star },
  { id: "trash", title: "Корзина", icon: Trash2 },
] as const;
export function Storage({ back }: { back: () => void }) {
  const [view, setView] = useState<string>("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const title = view === "home" ? "Домашнее" : sections.find(item => item.id === view)?.title ?? "Все файлы";
  function select(value: string) { setView(value); setMenuOpen(false); }
  return <>
    {menuOpen && <button type="button" className="ss-backdrop" aria-label="Закрыть меню хранилища" onClick={() => setMenuOpen(false)} />}
    <aside className={`ss-sidebar ${menuOpen ? "open" : ""}`} aria-label="Меню хранилища">
      <div className="ss-brand"><span className="ss-brand-mark"><Folder size={22} /></span>Файлы
        <button type="button" className="ss-menu-close ss-icon-button" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)}><X size={20} /></button>
      </div>
      <div><p className="ss-side-label">Навигация</p><nav className="ss-nav-list" aria-label="Разделы хранилища">
        {sections.map(item => <button type="button" key={item.id} className={`ss-nav ${view === item.id ? "active" : ""}`} aria-current={view === item.id ? "page" : undefined} onClick={() => select(item.id)}><item.icon size={18} />{item.title}</button>)}
      </nav></div>
      <div><p className="ss-side-label">Хранилища</p><div className="ss-nav-list">
        <button type="button" className={`ss-storage ${view === "home" ? "active" : ""}`} aria-current={view === "home" ? "page" : undefined} onClick={() => select("home")}><HardDrive size={18} /><span className="ss-storage-info"><span className="ss-storage-name">Домашнее</span><span className="ss-storage-sub">В разработке</span></span></button>
      </div></div>
    </aside>
    <main className="ss-main">
      <div className="ss-workspace">
        <header className="ss-topbar">
          <button type="button" className="ss-icon-button ss-mobile-back" aria-label="Назад к чатам" onClick={back}><ArrowLeft size={20} /></button>
          <button type="button" className="ss-icon-button ss-menu-toggle" aria-label="Открыть меню хранилища" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
          <div className="ss-search"><Search size={18} /><input type="search" placeholder={view === "trash" ? "Поиск в корзине" : "Поиск файлов"} aria-label="Поиск файлов" disabled /></div>
          <div className="ss-top-actions"><button type="button" className="ss-primary-button" disabled title="В разработке"><Upload size={16} /><span>Загрузить</span></button></div>
        </header>
        <div className="ss-heading"><h1>{title}</h1><div className="ss-headline-actions"><button type="button" className="ss-soft-button" disabled title="В разработке"><FolderPlus size={17} />Новая папка</button></div></div>
        <div className="ss-body-grid"><section className="ss-card ss-files-card" aria-label="Файлы">
          <div className="ss-table-head"><span>Название</span><span>Изменён</span><span>Размер</span><span /></div>
          <div className="ss-empty"><Folder size={42} /><h2>{view === "trash" ? "Корзина пуста" : view === "favorites" ? "Пока нет избранных файлов" : view === "recent" ? "Пока нет недавних файлов" : "В этой папке пока пусто"}</h2><p>Хранилище в разработке</p></div>
        </section></div>
      </div>
    </main>
  </>;
}
