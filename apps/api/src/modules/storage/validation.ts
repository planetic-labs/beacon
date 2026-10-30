import { z } from "zod";
export const nodeName = z.string().trim().min(1).max(240).refine(value =>
  !value.startsWith(".") && Buffer.byteLength(value,"utf8")<=255 && !/[\\/\x00-\x1f\x7f]/.test(value), "Некорректное имя");
export const uuid = z.uuid();
// File-manager uploads are streamed to the destination storage; chat limits are separate.
export const maxUploadSize = 1024 ** 4;
export const safeInlineTypes = new Set(["image/jpeg","image/png","image/webp","image/gif","image/avif","video/mp4","video/webm","audio/mpeg","audio/ogg","audio/wav","audio/webm","application/pdf"]);
export function guessedMime(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return ({jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif",avif:"image/avif",mp4:"video/mp4",webm:"video/webm",mp3:"audio/mpeg",ogg:"audio/ogg",wav:"audio/wav",pdf:"application/pdf",txt:"text/plain",md:"text/plain",csv:"text/plain",json:"text/plain",log:"text/plain"} as Record<string,string>)[ext??""]??"application/octet-stream";
}
