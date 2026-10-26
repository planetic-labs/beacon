import { z } from "zod";
const recording = z.object({ text: z.string().max(80), fileId: z.uuid(), duration: z.number().positive().max(301) });
export const messageTypes = {
  audio: { validate: recording, preview: () => "Голосовое сообщение" },
  circle: { validate: recording.extend({ duration: z.number().positive().max(61) }), preview: () => "Видеокружок" },
  sticker: {
    validate: z.object({ text: z.string().max(80), stickerId: z.uuid(), fileId: z.uuid() }),
    preview: (v: { text: string }) => `Стикер: ${v.text}`,
  },
  photo: {
    validate: z.union([
      z.object({ text: z.string().trim().max(10000), fileIds: z.array(z.uuid()).min(1).max(10) }),
      z.object({ text: z.string().trim().max(10000), fileId: z.uuid() }),
    ]),
    preview: (v: { text: string }) => v.text || "Фото",
  },
  text: {
    validate: z.object({ text: z.string().trim().min(1).max(10000) }),
    preview: (v: { text: string }) => v.text.slice(0, 120),
  },
};
export function directKey(a: string, b: string) {
  return [a, b].sort().join(":");
}
export const emojiSchema = z.enum([
  "❤️",
  "👍",
  "👎",
  "😂",
  "😮",
  "😢",
  "🙏",
  "🔥",
]);
