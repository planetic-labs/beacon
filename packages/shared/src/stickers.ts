import emojiRegex from "emoji-regex";
import { z } from "zod";

export const normalizeStickerText = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
// Ignore only text/emoji presentation selectors; preserve ZWJ, skin tone and flags.
export const emojiKey = (emoji: string) => emoji.normalize("NFC").replace(/[\uFE0E\uFE0F]/g, "");
export function extractEmoji(text: string): string[] { return Array.from(text.matchAll(emojiRegex()), match => match[0]); }
const pattern = emojiRegex();
const singleEmoji = new RegExp(`^(?:${pattern.source})$`, pattern.flags.replace("g", ""));
export const stickerMetadataSchema = z.object({
  label: z.string().trim().min(1).max(80),
  emojis: z.array(z.string().max(64).refine(value => singleEmoji.test(value), "Укажите стандартный эмодзи")).max(12)
    .transform(values => values.filter((value, index) => values.findIndex(other => emojiKey(other) === emojiKey(value)) === index)),
  keywords: z.array(z.string().trim().min(1).max(40)).max(32)
    .transform(values => [...new Set(values.map(normalizeStickerText))]),
});
export function parseStickerEmojiInput(text: string): string[] {
  // Spaces and commas separate emoji, but never split a Unicode sequence into code points.
  const emojis = extractEmoji(text);
  const rest = text.replace(emojiRegex(), "").replace(/[\s,;]+/g, "");
  if (rest) throw new Error("В поле эмодзи допустимы только эмодзи, пробелы и запятые");
  return emojis;
}
export function stickerSuggestionQuery(text: string): string {
  const trimmed = text.trimEnd();
  const matches = Array.from(trimmed.matchAll(emojiRegex()));
  const last = matches.at(-1);
  if (last && last.index + last[0].length === trimmed.length) return last[0];
  const word = trimmed.match(/[\p{L}\p{N}]+$/u)?.[0] ?? "";
  return word.length >= 2 ? word : "";
}

// Used only for validating persisted catalog data, never messages or user profiles.
export const stickerCatalogSchema = z.array(z.object({
  id: z.uuid(), name: z.string().max(80), active: z.boolean(),
  stickers: z.array(z.object({
    id: z.uuid(), fileId: z.uuid(), label: z.string().max(80),
    emojis: z.array(z.string().max(64)).max(12).default([]),
    keywords: z.array(z.string().max(40)).max(32).default([]),
  })).max(50000),
})).max(1000);
