import { sql } from "drizzle-orm";
import { searchWords, type SearchResults } from "@beacon/shared";
import { member, rows, type Actor } from "../chat/service";
export type SearchInput = { query: string; chatId?: string; authorId?: string; from?: string; to?: string; cursor?: { id: string; at: string } };
// Providers enforce authorization themselves; swapping ranking/storage never bypasses membership.
export interface SearchProvider { search(actor: Actor, input: SearchInput): Promise<SearchResults> }
export const postgresSearch: SearchProvider = {
  async search(actor, input) {
    if (input.chatId) await member(input.chatId, actor);
    const words = searchWords(input.query);
    if (!words.length) return { people: [], chats: [], messages: [] };
    const query = words.map(word => `${word}:*`).join(" & ");
    const vector = sql`to_tsvector('simple', beacon_search_normalize(coalesce(m.content->>'text','')))`;
    const messages = await rows<SearchResults["messages"][number]>(sql`
      select m.id,m.chat_id as "chatId",coalesce(c.title,(select u2.name from chat_member other join "user" u2 on u2.id=other.user_id where other.chat_id=c.id and other.user_id<>${actor.id} limit 1)) as "chatName",
      m.author_id as "authorId",u.name as "authorName",left(m.content->>'text',10000) as text,
      to_char(m.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"
      from message m join chat c on c.id=m.chat_id join "user" u on u.id=m.author_id
      where exists(select 1 from chat_member cm where cm.chat_id=m.chat_id and cm.user_id=${actor.id})
      and m.type in ('text','photo') and ${vector} @@ to_tsquery('simple',${query})
      ${input.chatId ? sql`and m.chat_id=${input.chatId}` : sql``}
      ${input.authorId ? sql`and m.author_id=${input.authorId}` : sql``}
      ${input.from ? sql`and m.created_at>=${input.from}::date` : sql``}
      ${input.to ? sql`and m.created_at<(${input.to}::date+interval '1 day')` : sql``}
      ${input.cursor ? sql`and (m.created_at,m.id)<(${input.cursor.at}::timestamptz,${input.cursor.id}::uuid)` : sql``}
      order by m.created_at desc,m.id desc limit 31`);
    const people = input.chatId || input.cursor ? [] : await rows<SearchResults["people"][number]>(sql`select id,name,image from "user" where not banned and to_tsvector('simple',beacon_search_normalize(name)) @@ to_tsquery('simple',${query}) order by name,id limit 15`);
    const chats = input.chatId || input.cursor ? [] : await rows<SearchResults["chats"][number]>(sql`select c.id,coalesce(c.title,(select u2.name from chat_member other join "user" u2 on u2.id=other.user_id where other.chat_id=c.id and other.user_id<>${actor.id} limit 1)) as name from chat c join chat_member cm on cm.chat_id=c.id and cm.user_id=${actor.id} where to_tsvector('simple',beacon_search_normalize(coalesce(c.title,(select u2.name from chat_member other join "user" u2 on u2.id=other.user_id where other.chat_id=c.id and other.user_id<>${actor.id} limit 1),''))) @@ to_tsquery('simple',${query}) order by name,c.id limit 15`);
    const page = messages.slice(0, 30), last = page.at(-1);
    return { people, chats, messages: page, ...(messages.length > 30 && last ? { next: { id: last.id, at: last.createdAt } } : {}) };
  },
};
export const search: SearchProvider["search"] = (actor, input) => postgresSearch.search(actor, input);
