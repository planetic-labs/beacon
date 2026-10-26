import { useEffect, useState } from "react";
import { stickerCatalogSchema } from "@beacon/shared";
import type { StickerPack } from "@beacon/shared";
type Catalog = { packs: StickerPack[]; etag?: string };
const cache = new Map<string, Catalog>();
const requests = new Map<string, Promise<void>>();
const storageKey = (id: string) => `sticker-catalog:v1:${id}`;
function read(userId: string): Catalog {
  if (cache.has(userId)) return cache.get(userId)!;
  let value: Catalog = { packs: [] };
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(userId)) || "null");
    const parsed = stickerCatalogSchema.safeParse(raw?.packs);
    if (parsed.success) value = { packs: parsed.data, etag: typeof raw.etag === "string" ? raw.etag : undefined };
  } catch { /* Ignore an outdated or unavailable local cache. */ }
  cache.set(userId, value); return value;
}
async function refresh(userId: string) {
  if (requests.has(userId)) return requests.get(userId);
  const request = (async () => {
    const previous = read(userId);
    const response = await fetch("/api/stickers", { cache: "no-store", headers: previous.etag ? { "If-None-Match": previous.etag } : {}, signal: AbortSignal.timeout(15000) });
    if (response.status === 401) { cache.delete(userId); try { localStorage.removeItem(storageKey(userId)); } catch {} window.dispatchEvent(new Event("beacon:unauthorized")); }
    if (response.status === 304) return;
    if (!response.ok) throw new Error("Не удалось загрузить стикеры");
    const value: Catalog = { packs: stickerCatalogSchema.parse(await response.json()), etag: response.headers.get("ETag") ?? undefined };
    cache.set(userId, value);
    try { localStorage.setItem(storageKey(userId), JSON.stringify(value)); } catch { /* The in-memory cache still works. */ }
    window.dispatchEvent(new Event("beacon:sticker-catalog"));
  })();
  requests.set(userId, request);
  try { await request; } finally { requests.delete(userId); }
}
export function useStickerCatalog(userId: string, enabled = true) {
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const stored = read(userId);
    setPacks(stored.packs);
    setLoading(!stored.packs.length);
    const changed = () => { if (live) setPacks(read(userId).packs); };
    const update = () => { void refresh(userId).then(() => { if (live) setError(undefined); }).catch(e => { if (live) setError(e); }).finally(() => { if (live) setLoading(false); }); };
    window.addEventListener("beacon:sticker-catalog", changed);
    window.addEventListener("beacon:stickers-changed", update);
    window.addEventListener("focus", update);
    update();
    return () => { live = false; window.removeEventListener("beacon:sticker-catalog", changed); window.removeEventListener("beacon:stickers-changed", update); window.removeEventListener("focus", update); };
  }, [userId, enabled]);
  return { packs: enabled ? packs : [], loading, error };
}
