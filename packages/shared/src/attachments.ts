import { z } from "zod";
export const attachmentLimits = { file: 100 * 1024 * 1024, video: 500 * 1024 * 1024 } as const;
export const attachmentSchema = z.object({
  text: z.string().trim().max(10000), fileId: z.uuid(), name: z.string().min(1).max(240),
  size: z.number().int().positive().max(attachmentLimits.video),
  mime: z.enum(["application/octet-stream", "video/mp4", "video/webm", "image/jpeg", "image/png", "image/webp"]),
});
export type AttachmentMime = z.infer<typeof attachmentSchema>["mime"];
export type AttachmentKind = "file" | "video";
export function attachmentName(value: string) {
  return value.split(/[\\/]/u).at(-1)!.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, "").trim().slice(0, 240).toWellFormed() || "Файл";
}
export function fileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ` : `${Math.max(1, Math.ceil(bytes / 1024))} КБ`;
}
