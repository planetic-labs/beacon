import { LocalStorage, type FileStorage } from "../files/storage";
export { LocalStorage, type FileStorage } from "../files/storage";
export const storage: FileStorage = new LocalStorage();
export function mediaUrl(id: string) {
  return `${process.env.MEDIA_BASE_URL?.replace(/\/$/, "") ?? ""}/media/${id}`;
}
export function imageMime(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}
