import { z } from "zod";
import { sql } from "drizzle-orm";
import { actor } from "../../lib/http";
import { member, rows } from "./service";
const activity = z.object({ chatId: z.uuid(), kind: z.enum(["typing","audio","circle"]).nullable() });
// Ephemeral transport boundary: no queued activity survives a process restart.
// PostgreSQL NOTIFY fans out between instances; a future Redis adapter can replace it.
export async function publishActivity(headers: Headers, input: unknown, source: string) {
  const value = activity.parse(input), user = await actor(headers);
  await member(value.chatId,user);
  const recipients = await rows(sql`select user_id from chat_member where chat_id=${value.chatId} and user_id<>${user.id}`);
  const data = {...value,userId:user.id,name:user.name,source,expiresAt:Date.now()+6500};
  for (const recipient of recipients)
    await rows(sql`select pg_notify('beacon_events',${JSON.stringify({kind:"chat.activity",userId:recipient.user_id,activity:data})})`);
  return value;
}
