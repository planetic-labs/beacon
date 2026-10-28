import { useEffect, useMemo, useState, useRef } from "react";
import { parseStickerEmojiInput, stickerMetadataSchema } from "@beacon/shared";
import { useStickerCatalog } from "../lib/sticker-catalog";
import { createStickerSearch, recentStickers, rememberSticker } from "../lib/sticker-search";
import type { Sticker, StickerPack } from "@beacon/shared";
import { Dialog } from "./ui";

async function upload(packId: string, files: File[]) {
  const data = new FormData(); files.forEach(file => data.append("file", file));
  const response = await fetch(`/api/stickers/${packId}`, { method: "POST", body: data, signal: AbortSignal.timeout(120000) });
  if (response.status === 401) window.dispatchEvent(new Event("beacon:unauthorized"));
  if (!response.ok) throw new Error((await response.json()).error || "Не удалось загрузить стикеры");
}
async function requestPacks(method = "GET", id = "", data?: unknown, scope?: "mine" | "all"): Promise<StickerPack[]> {
  const response = await fetch(`/api/stickers${id ? `/${id}` : ""}${scope ? `?scope=${scope}` : ""}`, { method, headers: data ? { "Content-Type": "application/json" } : undefined, body: data ? JSON.stringify(data) : undefined });
  if (response.status === 401) window.dispatchEvent(new Event("beacon:unauthorized"));
  if (!response.ok) throw new Error((await response.json()).error || "Не удалось загрузить наборы");
  return response.json();
}
function Tiles({ stickers, choose, remove, edit, busy }: { stickers: Sticker[]; choose?: (sticker: Sticker) => void; remove?: (sticker: Sticker) => void; edit?: (sticker: Sticker) => void; busy?: boolean }) {
  return <div className="sticker-grid">{stickers.map(sticker => choose
    ? <button type="button" key={sticker.id} title={sticker.label} aria-label={`Отправить стикер ${sticker.label}`} onClick={() => choose(sticker)}><img src={`/media/${sticker.fileId}`} alt={sticker.label} loading="lazy" /></button>
    : <div className="sticker-admin-tile" key={sticker.id}><img src={`/media/${sticker.fileId}`} alt={sticker.label} loading="lazy" />{edit && <button type="button" disabled={busy} aria-label={`Редактировать стикер ${sticker.label}`} onClick={() => edit(sticker)}>Метки</button>}{remove && <button type="button" disabled={busy} aria-label={`Удалить стикер ${sticker.label}`} onClick={() => remove(sticker)}>Удалить</button>}</div>)}</div>;
}
export function StickerPicker({ userId, close, choose, notify }: { userId: string; close: () => void; choose: (sticker: Sticker) => void; notify: (error: unknown) => void }) {
  const { packs: catalog, loading, error } = useStickerCatalog(userId);
  const packs = useMemo(() => catalog.filter(pack => pack.active), [catalog]);
  const [selected, setSelected] = useState("recent");
  const [query, setQuery] = useState("");
  const [recent] = useState(() => recentStickers(userId));
  useEffect(() => { if (error) notify(error); }, [error]);
  useEffect(() => { if (!recent.length && packs.length) setSelected(packs[0].id); }, [packs]);
  const all = useMemo(() => packs.flatMap(pack => pack.stickers), [packs]);
  const search = useMemo(() => createStickerSearch(all), [all]);
  const stickers = query.trim() ? search(query, recent) : selected === "recent" ? recent.flatMap(id => all.filter(sticker => sticker.id === id)) : packs.find(pack => pack.id === selected)?.stickers ?? [];
  return <Dialog title="Стикеры" close={close}>
    <input className="sticker-search" aria-label="Поиск стикеров" placeholder="Слово или эмодзи" value={query} maxLength={100} onChange={e => setQuery(e.target.value)} />
    <div className="sticker-tabs"><button type="button" className={selected === "recent" ? "active" : ""} onClick={() => setSelected("recent")}>Недавние</button>{packs.map(pack => <button key={pack.id} type="button" className={selected === pack.id ? "active" : ""} onClick={() => setSelected(pack.id)}>{pack.name}</button>)}</div>
    {loading ? <p>Загружаем стикеры…</p> : stickers.length ? <Tiles stickers={stickers} choose={sticker => {
      rememberSticker(userId, sticker.id);
      choose(sticker); close();
    }} /> : <p className="field-note">{query.trim() ? "Подходящих стикеров нет." : selected === "recent" ? "Здесь появятся недавно выбранные стикеры." : "В этом наборе пока нет стикеров."}</p>}
    {!loading && !packs.length && <p className="field-note">Пока нет включённых наборов.</p>}
  </Dialog>;
}
export function StickerAdmin({ notify, scope = "all" }: { notify: (error: unknown) => void; scope?: "mine" | "all" }) {
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [name, setName] = useState("");
  const [deletingPack, setDeletingPack] = useState<StickerPack | null>(null);
  const [editingSticker, setEditingSticker] = useState<{ packId: string; sticker: Sticker } | null>(null);
  const [editingPack, setEditingPack] = useState<string | null>(null);
  const [packName, setPackName] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() { setPacks(await requestPacks("GET", "", undefined, scope)); }
  useEffect(() => {
    let live=true;
    void requestPacks("GET","",undefined,scope).then(value=>{if(live)setPacks(value);}).catch(error=>{if(live)notify(error);});
    return()=>{live=false;};
  }, [scope]);
  async function action(work: () => Promise<unknown>) {
    setBusy(true); try { await work(); await refresh(); window.dispatchEvent(new Event("beacon:stickers-changed")); } catch (e) { notify(e); } finally { setBusy(false); }
  }
  return <section className="settings-card"><h2>{scope === "mine" ? "Мои наборы стикеров" : "Наборы стикеров"}</h2>
    <p className="field-note">Включённые наборы доступны всем участникам. Выключенные не показываются в выборе стикеров.</p>
    <form className="sticker-create" onSubmit={event => { event.preventDefault(); if (!name.trim() || busy) return; void action(async () => { await requestPacks("POST", "", { name }); setName(""); }); }}>
      <input aria-label="Название набора стикеров" placeholder="Название набора" maxLength={80} required value={name} disabled={busy} onChange={e => setName(e.target.value)} />
      <button className="primary-button" disabled={busy || !name.trim()}>Создать набор</button>
    </form>
    <p className="field-note">PNG, JPEG или WebP до 10 МБ каждый. Изображения автоматически уменьшаются до 512 × 512 и сохраняются в WebP с сохранением пропорций и прозрачности. За один раз можно загрузить до 10 файлов. Названия берутся из имён файлов.</p>
    {packs.map(pack => <div key={pack.id} className="sticker-admin-pack">
      <div className="panel-heading"><strong>{pack.name} · {pack.stickers.length}</strong><div className="sticker-pack-actions"><button type="button" className="secondary-button" disabled={busy} aria-label={`Переименовать набор ${pack.name}`} onClick={() => { setEditingPack(pack.id); setPackName(pack.name); }}>Переименовать</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void action(() => requestPacks("PATCH", pack.id, { active: !pack.active }))}>{pack.active ? "Отключить набор" : "Включить набор"}</button><button type="button" className="text-button" disabled={busy} aria-label={`Удалить набор ${pack.name}`} onClick={()=>setDeletingPack(pack)}>Удалить набор</button></div></div>
      {scope === "all" && <p className="field-note">Владелец: {pack.ownerName || "Не назначен"}</p>}
      {editingPack === pack.id && <form className="sticker-create" onSubmit={event => {
        event.preventDefault(); if (busy || !packName.trim()) return;
        void action(async () => { await requestPacks("PATCH", pack.id, { name: packName.trim() }); setEditingPack(null); });
      }}><input aria-label="Новое название набора" value={packName} onChange={event => setPackName(event.target.value)} maxLength={80} required autoFocus disabled={busy} /><button className="primary-button" disabled={busy || !packName.trim()}>Сохранить название</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setEditingPack(null)}>Отмена</button></form>}
      <label className="sticker-upload">Добавить стикеры<input type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label={`Добавить стикеры в ${pack.name}`} disabled={busy} onChange={event => {
        const files = Array.from(event.target.files ?? []); event.target.value = "";
        if (!files.length) return;
        if (files.length > 10 || files.some(file => !file.size || file.size > 10 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type))) { notify(new Error("Выберите до 10 файлов PNG, JPEG или WebP, до 10 МБ каждый")); return; }
        void action(() => upload(pack.id, files));
      }} /></label>
      {!pack.active && <p className="field-note">Набор отключён. Отправленные стикеры сохраняются в переписке.</p>}
      <Tiles stickers={pack.stickers} busy={busy} edit={sticker => setEditingSticker({ packId: pack.id, sticker })} remove={sticker => void action(() => requestPacks("DELETE", `${pack.id}/stickers/${sticker.id}`))} />
    </div>)}
    {!packs.length && <p className="field-note">{scope === "mine" ? "У вас пока нет наборов. Создайте первый." : "Наборов пока нет."}</p>}
    {deletingPack && <Dialog title="Удалить набор?" close={()=>{if(!busy)setDeletingPack(null);}}>
      <p>Удалить набор «{deletingPack.name}»? Он исчезнет у всех участников. Уже отправленные стикеры сохранятся в переписках.</p>
      <div className="inline-actions"><button type="button" className="primary-button" disabled={busy} onClick={()=>void action(async()=>{await requestPacks("DELETE",deletingPack.id);setDeletingPack(null);setEditingSticker(null);setEditingPack(null);})}>Удалить набор</button><button type="button" className="secondary-button" disabled={busy} onClick={()=>setDeletingPack(null)}>Отмена</button></div>
    </Dialog>}
    {editingSticker && <StickerMetadataEditor sticker={editingSticker.sticker} close={() => setEditingSticker(null)} save={async metadata => {
      await requestPacks("PATCH", `${editingSticker.packId}/stickers/${editingSticker.sticker.id}`, metadata);
      await refresh(); window.dispatchEvent(new Event("beacon:stickers-changed")); setEditingSticker(null);
    }} notify={notify} />}
  </section>;
}

function StickerMetadataEditor({ sticker, close, save, notify }: { sticker: Sticker; close: () => void; save: (metadata: { label: string; emojis: string[]; keywords: string[] }) => Promise<void>; notify: (error: unknown) => void }) {
  const [label, setLabel] = useState(sticker.label);
  const [emojis, setEmojis] = useState((sticker.emojis ?? []).join(" "));
  const [keywords, setKeywords] = useState((sticker.keywords ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  return <Dialog title="Метки стикера" close={() => { if (!busy) close(); }}><form className="sticker-metadata-form" onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      const values = stickerMetadataSchema.safeParse({ label, emojis: parseStickerEmojiInput(emojis), keywords: keywords.split(/[,;\n]/).map(word => word.trim()).filter(Boolean) });
      if (!values.success) throw new Error("Укажите название до 80 символов, до 12 эмодзи и до 32 тегов по 40 символов");
      await save(values.data);
    } catch (error) { notify(error); } finally { setBusy(false); }
  }}>
    <img className="sticker-editor-image" src={`/media/${sticker.fileId}`} alt={sticker.label} />
    <label>Название<input aria-label="Название стикера" required maxLength={80} value={label} disabled={busy} onChange={e => setLabel(e.target.value)} /></label>
    <label>Эмодзи<input aria-label="Эмодзи стикера" placeholder="👋 🙂" maxLength={768} value={emojis} disabled={busy} onChange={e => setEmojis(e.target.value)} /></label>
    <p className="field-note">Вставьте эмодзи с клавиатуры устройства. До 12 эмодзи, через пробел. Используется стандарт Unicode.</p>
    <label>Ключевые слова<textarea aria-label="Ключевые слова стикера" placeholder="привет, здравствуйте, пока" maxLength={1400} value={keywords} disabled={busy} onChange={e => setKeywords(e.target.value)} /></label>
    <p className="field-note">До 32 слов или фраз через запятую. Например: привет, доброе утро.</p>
    <div className="sticker-pack-actions"><button className="primary-button" disabled={busy}>Сохранить метки</button><button type="button" className="secondary-button" disabled={busy} onClick={close}>Отмена</button></div>
  </form></Dialog>;
}

export function StickerSuggestions({ userId, text, choose }: { userId: string; text: string; choose: (sticker: Sticker) => void }) {
  const { packs } = useStickerCatalog(userId, !!text);
  const [query, setQuery] = useState("");
  useEffect(() => { const timer=setTimeout(()=>setQuery(text),200); return()=>clearTimeout(timer); }, [text]);
  const all = useMemo(() => packs.filter(pack => pack.active).flatMap(pack => pack.stickers), [packs]);
  const search = useMemo(() => createStickerSearch(all), [all]);
  const matches = useMemo(() => search(query, recentStickers(userId), 8), [search, query, userId]);
  const [preview, setPreview] = useState<Sticker | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const clearHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  useEffect(() => () => clearHold(), []);
  useEffect(() => { setPreview(null); }, [text]);
  if (!text || text !== query || !matches.length) return null;
  return <div className="sticker-suggestions" aria-label="Подходящие стикеры">
    <div className="sticker-suggestion-items">{matches.map(sticker => <button type="button" key={sticker.id} aria-label={`Предложенный стикер ${sticker.label}`}
      onMouseEnter={() => setPreview(sticker)} onMouseLeave={() => setPreview(null)}
      onFocus={() => setPreview(sticker)} onBlur={() => setPreview(null)}
      onPointerDown={event => { held.current = false; if (event.pointerType !== "mouse") hold.current = setTimeout(() => { held.current = true; setPreview(sticker); }, 450); }}
      onPointerUp={() => { clearHold(); if (held.current) setPreview(null); }} onPointerCancel={() => { clearHold(); setPreview(null); }} onPointerLeave={clearHold}
      onContextMenu={event => event.preventDefault()}
      onClick={() => { if (held.current) { held.current = false; return; } rememberSticker(userId, sticker.id); setPreview(null); choose(sticker); }}>
      <img src={`/media/${sticker.fileId}`} alt={sticker.label} loading="lazy" />
    </button>)}</div>
    {preview && <div className="sticker-suggestion-preview" role="img" aria-label={`Предпросмотр: ${preview.label}`}><img src={`/media/${preview.fileId}`} alt="" /><span>{preview.label}</span></div>}
  </div>;
}
