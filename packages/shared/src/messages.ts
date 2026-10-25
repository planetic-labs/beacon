import { z } from "zod";
export const messageTypes = {
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
