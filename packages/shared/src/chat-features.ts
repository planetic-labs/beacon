import { z } from "zod";
export const mentionSchema = z.object({ userId: z.uuid(), start: z.number().int().nonnegative().max(10000), length: z.number().int().min(2).max(170) });
export const mentionsSchema = z.array(mentionSchema).max(20);
export type Mention = z.infer<typeof mentionSchema>;
export type Receipt = { userId: string; name: string; joinedAt: string; deliveredAt: string; readAt: string };
export type ChatActivity = { chatId: string; userId: string; name: string; kind: "typing" | "audio" | "circle" | null; expiresAt: number; source: string };
export type SearchHit = { id: string; chatId: string; chatName: string; authorId: string; authorName: string; text: string; createdAt: string };
export type SearchResults = { people: { id: string; name: string; image?: string }[]; chats: { id: string; name: string }[]; messages: SearchHit[]; next?: { id: string; at: string } };
export function searchWords(value: string) { return (value.toLowerCase().replaceAll("ё", "е").match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12); }
// Offsets follow textarea/JavaScript UTF-16 positions. Editing through a mention removes it.
export function moveMentions(before: string, after: string, mentions: Mention[]): Mention[] {
  let start = 0; while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = before.length, nextEnd = after.length;
  while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
  return mentions.flatMap(m => m.start + m.length <= start ? [m] : m.start >= end ? [{ ...m, start: m.start + nextEnd - end }] : []);
}
export function deliveryLabel(receipts: Receipt[], authorId: string, createdAt: string) {
  const eligible = receipts.filter(r => r.userId !== authorId && r.joinedAt <= createdAt);
  const read = eligible.filter(r => r.readAt >= createdAt).length;
  const delivered = eligible.filter(r => r.deliveredAt >= createdAt || r.readAt >= createdAt).length;
  if (eligible.length && read === eligible.length) return "Прочитано";
  if (read) return `Прочитано ${read} из ${eligible.length}`;
  if (eligible.length && delivered === eligible.length) return "Доставлено";
  return delivered ? `Доставлено ${delivered} из ${eligible.length}` : "Отправлено";
}
