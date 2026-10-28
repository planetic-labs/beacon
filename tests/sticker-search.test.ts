import { test } from "node:test";
import assert from "node:assert/strict";
import { emojiKey, parseStickerEmojiInput, stickerMetadataSchema, stickerSuggestionQuery, type Sticker } from "../packages/shared/src";
import { createStickerSearch } from "../apps/web/src/lib/sticker-search";
const stickers: Sticker[] = [
  { id: "wave", fileId: "1", label: "Машущий кот", emojis: ["👋", "🙂"], keywords: ["привет", "здравствуй"] },
  { id: "heart", fileId: "2", label: "Обнимаю", emojis: ["❤️"], keywords: ["любовь", "спасибо"] },
  { id: "another-wave", fileId: "3", label: "Приветствие", emojis: ["👋"], keywords: ["привет"] },
  { id: "symbol", fileId: "5", label: "Товарный знак", emojis: ["™️", "Ⓜ️"], keywords: [] },
  { id: "family", fileId: "4", label: "Семья", emojis: ["👨‍👩‍👧‍👦"], keywords: ["семья"] },
];
test("Unicode emoji preserve sequences and distinguish modifiers", () => {
  assert.deepEqual(parseStickerEmojiInput("👨‍👩‍👧‍👦 👋🏽, 🇷🇺 1️⃣ ❤️"), ["👨‍👩‍👧‍👦", "👋🏽", "🇷🇺", "1️⃣", "❤️"]);
  assert.equal(emojiKey("❤️"), emojiKey("❤"));
  assert.notEqual(emojiKey("👋"), emojiKey("👋🏽"));
  assert.throws(() => parseStickerEmojiInput("hello 🙂"));
  const metadata = stickerMetadataSchema.parse({ label: " Кот ", emojis: ["❤️", "❤", "👨‍👩‍👧‍👦"], keywords: [" ПРИВЕТ ", "привет", "Ещё"] });
  assert.equal(metadata.label, "Кот"); assert.equal(metadata.emojis.length, 2);
  assert.deepEqual(metadata.keywords, ["привет", "еще"]);
  assert.equal(stickerMetadataSchema.safeParse({ label: "x", emojis: ["hello"], keywords: [] }).success, false);
});
test("local search matches metadata, emoji and typos, prioritizing exact and recent matches", () => {
  const search = createStickerSearch(stickers);
  assert.deepEqual(search("👋", ["another-wave"]).map(s => s.id), ["another-wave", "wave"]);
  assert.equal(search("❤")[0].id, "heart");
  assert.equal(search("™️")[0].id, "symbol");
  assert.equal(search("Ⓜ️")[0].id, "symbol");
  assert.ok(search("ПРЕВЕТ").some(sticker => sticker.id === "wave"));
  assert.equal(search("спасибо")[0].id, "heart");
  assert.equal(search("👨‍👩‍👧‍👦")[0].id, "family");
  assert.deepEqual(search("👋🏽"), []);
  assert.deepEqual(search("несуществующийтег"), []);
  assert.equal(search("привет", [], 1).length, 1);
  assert.deepEqual(search("Машущий кот"), [], "labels do not participate in text search");
  assert.deepEqual(search("Обнимаю"), [], "an exact label without a matching keyword is excluded");
  const labelOnly=createStickerSearch([{id:"label-only",fileId:"6",label:"Привет",emojis:["👋"],keywords:[]}]);
  assert.deepEqual(labelOnly("привет"), []);
  assert.deepEqual(labelOnly("превет"), []);
  assert.equal(labelOnly("👋")[0].id,"label-only");
});
test("composer suggestions accept only one word or one complete emoji", () => {
  for (const word of ["привет", "  привет  ", "Hello", "превет"]) assert.equal(stickerSuggestionQuery(word), word.trim());
  for (const emoji of ["❤️", "👨‍👩‍👧‍👦", "👋🏽", "🇷🇺", "  🙂  "]) assert.equal(stickerSuggestionQuery(emoji), emoji.trim());
  for (const text of ["", "а", "Ну что, привет", "люблю ❤️ ", "семья 👨‍👩‍👧‍👦", "привет!", "привет\nмир", "🙂🙂", "🙂 привет", "привет 🙂", "@привет", "https://example.com/привет"]) assert.equal(stickerSuggestionQuery(text), "", text);
});
