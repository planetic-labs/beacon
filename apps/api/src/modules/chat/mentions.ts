import { mentionsSchema, type Mention } from "@beacon/shared";
import { sql } from "drizzle-orm";
import { HttpError } from "../../lib/http";
import { rows, type Tx } from "./service";
export async function validateMentions(tx: Tx, chatId: string, text: string, raw: unknown): Promise<Mention[]> {
  const mentions = mentionsSchema.parse(raw ?? []).slice().sort((a,b)=>a.start-b.start);
  if (!mentions.length) return [];
  const members = await rows(sql`select u.id,u.name from "user" u join chat_member cm on cm.user_id=u.id where cm.chat_id=${chatId} and not u.banned`, tx);
  let end = 0;
  for (const mention of mentions) {
    const user = members.find(u=>u.id===mention.userId);
    const value = text.slice(mention.start, mention.start+mention.length);
    if (!user || mention.start < end || value !== `@${user.name}` || mention.start+mention.length>text.length)
      throw new HttpError(400, "Выберите участника для упоминания заново");
    end = mention.start+mention.length;
  }
  return mentions;
}
