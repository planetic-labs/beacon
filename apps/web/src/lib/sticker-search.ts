import Fuse from "fuse.js";
import { emojiKey, extractEmoji, normalizeStickerText, type Sticker } from "@beacon/shared";

export function createStickerSearch(stickers: Sticker[]) {
  const entries = stickers.map(sticker => ({ sticker, keywords: (sticker.keywords ?? []).map(normalizeStickerText) }));
  const fuse = new Fuse(entries, { keys: ["keywords"], threshold: 0.3, ignoreLocation: true, minMatchCharLength: 2, includeScore: true });
  return (query: string, recent: string[] = [], limit = 48): Sticker[] => {
    const text = normalizeStickerText(query);
    if (!text) return [];
    const rawEmoji = extractEmoji(query);
    const emojiKeys = rawEmoji.map(emojiKey);
    const emojiOnly = query.replace(/\s/g, "") === rawEmoji.join("");
    const scores = new Map<string, number>();
    for (const entry of entries) {
      if (emojiKeys.length && (entry.sticker.emojis ?? []).some(emoji => emojiKeys.includes(emojiKey(emoji)))) scores.set(entry.sticker.id, 0);
      if (!emojiOnly && entry.keywords.includes(text)) scores.set(entry.sticker.id, 0);
    }
    if (!emojiOnly && text.length >= 2) for (const result of fuse.search(text))
      if (!scores.has(result.item.sticker.id)) scores.set(result.item.sticker.id, 1 + (result.score ?? 1));
    const recentIndex = new Map(recent.map((id, index) => [id, index]));
    return stickers.filter(sticker => scores.has(sticker.id)).sort((a, b) =>
      scores.get(a.id)! - scores.get(b.id)! || (recentIndex.get(a.id) ?? 1000) - (recentIndex.get(b.id) ?? 1000) || a.label.localeCompare(b.label, "ru"),
    ).slice(0, limit);
  };
}
export function recentStickers(userId: string): string[] {
  try { const saved = JSON.parse(localStorage.getItem(`stickers:${userId}`) || "[]"); return Array.isArray(saved) ? saved.filter(id => typeof id === "string").slice(0, 24) : []; } catch { return []; }
}
export function rememberSticker(userId: string, id: string) {
  try { localStorage.setItem(`stickers:${userId}`, JSON.stringify([id, ...recentStickers(userId).filter(value => value !== id)].slice(0, 24))); } catch { /* Browser storage is optional. */ }
}
