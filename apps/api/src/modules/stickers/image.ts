import sharp from "sharp";
import { HttpError } from "@api/lib/http";
import { imageMime } from "@api/modules/media/storage";

export const MAX_STICKER_SOURCE_BYTES = 10 * 1024 * 1024;

export async function prepareSticker(bytes: Uint8Array): Promise<Buffer> {
  if (!bytes.length || bytes.length > MAX_STICKER_SOURCE_BYTES)
    throw new HttpError(400, "Исходное изображение должно быть до 10 МБ");
  if (!imageMime(bytes)) throw new HttpError(400, "Поддерживаются PNG, JPEG и WebP");
  try {
    const image = sharp(bytes, { limitInputPixels: 16 * 1024 * 1024, failOn: "warning" });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 1)
      throw new HttpError(400, "Пока поддерживаются только неподвижные стикеры");
    // Re-encoding strips source metadata; rotate applies EXIF orientation first.
    return await image.rotate()
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85, alphaQuality: 100, effort: 4 })
      .timeout({ seconds: 10 })
      .toBuffer();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Не удалось обработать изображение: проверьте файл и размер (до 16 мегапикселей)");
  }
}
