import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { prepareSticker } from "../apps/api/src/modules/stickers/image";
const sharp = createRequire(new URL("../apps/api/package.json", import.meta.url))("sharp") as typeof import("../apps/api/node_modules/sharp").default;

test("large transparent originals become bounded WebP without metadata", async () => {
  const source = await sharp(randomBytes(1024 * 768 * 4), { raw: { width: 1024, height: 768, channels: 4 } }).png().toBuffer();
  assert.ok(source.length > 2 * 1024 * 1024);
  const result = await prepareSticker(source);
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 384);
  assert.equal(metadata.hasAlpha, true);
  assert.equal(metadata.exif, undefined);
  assert.ok(result.length < source.length);
  assert.ok(result.length < 1024 * 1024);
});
test("sticker processing preserves small sizes and applies camera orientation", async () => {
  const small = await sharp({ create: { width: 24, height: 12, channels: 4, background: "transparent" } }).png().toBuffer();
  const metadata = await sharp(await prepareSticker(small)).metadata();
  assert.equal(metadata.width, 24); assert.equal(metadata.height, 12);
  const rotated = await sharp({ create: { width: 1024, height: 512, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const oriented = await sharp(await prepareSticker(rotated)).metadata();
  assert.equal(oriented.width, 256); assert.equal(oriented.height, 512);
  assert.equal(oriented.exif, undefined);
});
test("sticker processing rejects invalid, oversized and excessive-resolution sources", async () => {
  for (const source of [Buffer.from("invalid"), Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(10 * 1024 * 1024 + 1)])
    await assert.rejects(prepareSticker(source), (error: { status?: number }) => error.status === 400);
  const huge = await sharp({ create: { width: 4097, height: 4097, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(prepareSticker(huge), (error: { status?: number }) => error.status === 400);
});
