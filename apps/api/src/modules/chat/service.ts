import { validateMentions } from "./mentions";
import type { Mention, AttachmentMime } from "@beacon/shared";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { HttpError } from "../../lib/http";
import { directKey, messageTypes } from "./types";
import { v7 } from "uuid";
export type Actor = { id: string; role: string };
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function rows<T = Record<string, any>>(
  q: ReturnType<typeof sql>,
  tx: Tx | typeof db = db,
): Promise<T[]> {
  return (await tx.execute(q)).rows as T[];
}
export async function writable(tx: Tx, u: Actor) {
  const [found] = await rows(
    sql`select id,role from "user" where id=${u.id} and not banned for update`,
    tx,
  );
  if (!found) throw new HttpError(401, "Доступ приостановлен");
  return found;
}
export async function member(
  chatId: string,
  u: Actor,
  tx: Tx | typeof db = db,
  lock = false,
) {
  const [c] = await rows(
    sql`select c.* from chat c join chat_member m on m.chat_id=c.id where c.id=${chatId} and m.user_id=${u.id} ${lock ? sql`for update of c` : sql``}`,
    tx,
  );
  if (!c) throw new HttpError(403, "Нет доступа к чату");
  return c;
}
export async function event(tx: Tx, chatId: string, userIds?: string[]) {
  const ids =
    userIds ??
    (
      await rows(
        sql`select user_id from chat_member where chat_id=${chatId}`,
        tx,
      )
    ).map((x) => x.user_id);
  await tx.execute(
    sql`insert into outbox(kind,payload) values('chat.changed',${JSON.stringify({ chatId, userIds: ids })}::jsonb)`,
  );
}
export async function createChat(
  u: Actor,
  input: { kind: "direct" | "group"; userIds: string[]; title?: string },
) {
  return db.transaction(async (tx) => {
    await writable(tx, u);
    const ids = [...new Set([u.id, ...input.userIds])].sort();
    if (input.kind === "direct" && ids.length !== 2)
      throw new HttpError(400, "Выберите другого пользователя");
    const active = await rows(
      sql`select id from "user" where id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`,`,
      )}) and not banned`,
      tx,
    );
    if (active.length !== ids.length)
      throw new HttpError(400, "Участник недоступен");
    const key = input.kind === "direct" ? directKey(ids[0], ids[1]) : null;
    if (key)
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`,
      );
    if (key) {
      const [existing] = await rows(
        sql`select id from chat where direct_key=${key}`,
        tx,
      );
      if (existing) return existing;
    }
    const [c] = await rows(
      sql`insert into chat(kind,title,owner_id,direct_key) values(${input.kind},${input.title ?? null},${u.id},${key}) returning id`,
      tx,
    );
    for (const id of ids)
      await tx.execute(
        sql`insert into chat_member(chat_id,user_id) values(${c.id},${id})`,
      );
    await event(tx, c.id);
    return c;
  });
}
export async function chatList(u: Actor) {
  return rows(sql`
 select c.id,c.kind,c.title,c.description,c.history_revision as "historyRevision",coalesce((select muted from chat_notification_preference np where np.chat_id=c.id and np.user_id=${u.id}),false) as muted,m.pinned,c.owner_id as "ownerId",c.image,
 case when c.kind='direct' then (select m2.user_id from chat_member m2 where m2.chat_id=c.id and m2.user_id<>${u.id} limit 1) end as "peerId",
 case when c.kind='direct' then (select name from "user" u2 join chat_member m2 on m2.user_id=u2.id where m2.chat_id=c.id and u2.id<>${u.id} limit 1) else c.title end as name,
 case when c.kind='direct' then (select image from "user" u2 join chat_member m2 on m2.user_id=u2.id where m2.chat_id=c.id and u2.id<>${u.id} limit 1) else c.image end as avatar,
 case when last_msg.type in ('file','video') then coalesce(nullif(last_msg.content->>'text',''),case when last_msg.type='video' then 'Видео: ' else 'Файл: ' end || (last_msg.content->>'name')) when last_msg.type='sticker' then 'Стикер: ' || (last_msg.content->>'text') else coalesce(nullif(last_msg.content->>'text',''),case when last_msg.type='photo' then 'Фото' end) end as preview,last_msg.id as "lastMessageId",last_msg.created_at as "lastAt",
 (select count(*)::int from message msg where msg.chat_id=c.id and msg.author_id<>${u.id} and msg.deleted_at is null and msg.created_at>m.last_read_at) as unread,
 (select msg.id from message msg where msg.chat_id=c.id and msg.author_id<>${u.id} and msg.deleted_at is null and msg.created_at>m.last_read_at order by msg.created_at desc,msg.id desc limit 1) as "lastUnreadMessageId",
 (select count(*)::int from message msg where msg.chat_id=c.id and msg.author_id<>${u.id} and msg.deleted_at is null and msg.created_at>m.last_read_at and msg.forwarded_from is null and msg.content->'mentions' @> ${JSON.stringify([{userId:u.id}])}::jsonb) as "unreadMentions"
 from chat c join chat_member m on m.chat_id=c.id and m.user_id=${u.id}
 left join lateral(select id,type,content,created_at from message where chat_id=c.id and deleted_at is null order by created_at desc,id desc limit 1) last_msg on true
 order by m.pinned desc,last_msg.created_at desc nulls last,name,c.id`);
}
export async function history(
  chatId: string,
  u: Actor,
  cursor?: { at: string; id: string },
  after = false,
  inclusive = false,
  throughId?: string,
  window?: { readAt: string; read: boolean; limit: number },
) {
  const chatState=await member(chatId, u);
  const limit=window?.limit??50;
  let bound = sql``;
  if (cursor)
    bound = after
      ? inclusive
        ? sql`and (m.created_at,m.id)>=(${cursor.at}::timestamptz,${cursor.id}::uuid)`
        : sql`and (m.created_at,m.id)>(${cursor.at}::timestamptz,${cursor.id}::uuid)`
      : sql`and (m.created_at,m.id)<(${cursor.at}::timestamptz,${cursor.id}::uuid)`;
  const result =
    await rows(sql`select m.id,m.chat_id as "chatId",m.author_id as "authorId",m.client_message_id as "clientMessageId",m.type,m.content,to_char(m.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",m.edited_at as "editedAt",m.deleted_at as "deletedAt",exists(select 1 from pinned_message pm where pm.message_id=m.id) as pinned,m.reply_to_id as "replyToId",m.forwarded_from as "forwardedFrom",u.name as "authorName",u.image as "authorImage",
   (select json_build_object('id',r.id,'text',coalesce(nullif(r.content->>'text',''),case when r.type='photo' then 'Фото' end),'authorName',ru.name) from message r join "user" ru on ru.id=r.author_id where r.id=m.reply_to_id and r.chat_id=m.chat_id) as reply,
   coalesce((select json_agg(json_build_object('userId',r.user_id,'name',ur.name,'emoji',r.emoji)) from reaction r join "user" ur on ur.id=r.user_id where r.message_id=m.id),'[]'::json) as reactions
   from message m join "user" u on u.id=m.author_id where m.chat_id=${chatId} ${window ? (window.read ? sql`and m.created_at<=${window.readAt}::timestamptz` : sql`and m.created_at>${window.readAt}::timestamptz`) : sql``} and exists(select 1 from chat_member cm where cm.chat_id=m.chat_id and cm.user_id=${u.id}) ${bound} ${throughId ? sql`and (m.created_at,m.id)<=(select created_at,id from message where id=${throughId} and chat_id=${chatId})` : sql``} order by m.created_at ${after ? sql`asc` : sql`desc`},m.id ${after ? sql`asc` : sql`desc`} limit ${limit+1}`);
  return {
    historyRevision: Number(chatState.history_revision??0),
    messages: after ? result.slice(0, limit) : result.slice(0, limit).reverse(),
    hasMore: result.length > limit,
  };
}
// One bounded, authoritative device snapshot. The read boundary is captured once
// so concurrent read receipts cannot introduce a gap between the two windows.
export async function offlineHistory(chatId:string,u:Actor) {
  const chatState=await member(chatId,u);
  const [state]=await rows<{readAt:string}>(sql`select to_char(last_read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "readAt" from chat_member where chat_id=${chatId} and user_id=${u.id}`);
  if(!state)throw new HttpError(403,"Нет доступа к чату");
  const [read,unread]=await Promise.all([
    history(chatId,u,undefined,false,false,undefined,{readAt:state.readAt,read:true,limit:100}),
    history(chatId,u,undefined,false,false,undefined,{readAt:state.readAt,read:false,limit:1000}),
  ]);
  return {historyRevision:Number(chatState.history_revision??0),messages:[...read.messages,...unread.messages],hasMoreRead:read.hasMore,hasMoreUnread:unread.hasMore,unreadStartId:unread.messages[0]?.id};
}
export async function send(
  u: Actor,
  chatId: string,
  input: {
    clientMessageId: string;
    text: string;
    mentions?: Mention[];
    replyToId?: string;
    forwardId?: string;
    stickerId?: string;
    attachment?: { id: string; name: string; size: number; mime: AttachmentMime; kind: "file" | "video" };
    recording?: { id: string; mime: string; size: number; kind: "audio" | "circle"; duration: number };
    photos?: { id: string; mime: string; size: number }[];
  },
  transaction?: Tx,
  notify = true,
) {
  const run = async (tx:Tx) => {
    await writable(tx, u);
    await member(chatId, u, tx, true);
    const [old] = await rows(
      sql`select id,chat_id from message where author_id=${u.id} and client_message_id=${input.clientMessageId}`,
      tx,
    );
    if (old) {
      if (old.chat_id !== chatId)
        throw new HttpError(409, "Повторный идентификатор сообщения");
      return { id: old.id };
    }
    let type = input.photos ? "photo" : "text";
    let content: { text: string; mentions?: Mention[]; name?: string; size?: number; mime?: string; fileId?: string; fileIds?: string[]; stickerId?: string; duration?: number } = input.photos
      ? messageTypes.photo.validate.parse({ text: input.text, fileIds: input.photos.map(photo => photo.id) })
      : input.forwardId || input.stickerId || input.recording || input.attachment ? { text: "" } : messageTypes.text.validate.parse({ text: input.text });
    let forwarded = null;
    for (const photo of input.photos ?? []) {
      await tx.execute(sql`insert into media_file(id,owner_id,storage_key,mime,size) values(${photo.id},${u.id},${photo.id},${photo.mime},${photo.size})`);
    }
    if (input.attachment) {
      const file = input.attachment;
      type = file.kind;
      content = messageTypes[file.kind].validate.parse({ text: input.text, fileId: file.id, name: file.name, size: file.size, mime: file.mime });
      await tx.execute(sql`insert into media_file(id,owner_id,storage_key,mime,size,original_name) values(${file.id},${u.id},${file.id},${file.mime},${file.size},${file.name})`);
    }
    if (input.recording) {
      const recording = input.recording;
      type = recording.kind;
      content = messageTypes[recording.kind].validate.parse({ fileId: recording.id, duration: recording.duration, text: recording.kind === "audio" ? "Голосовое сообщение" : "Видеокружок" });
      await tx.execute(sql`insert into media_file(id,owner_id,storage_key,mime,size) values(${recording.id},${u.id},${recording.id},${recording.mime},${recording.size})`);
    }
    if (input.stickerId && !input.forwardId) {
      const [sticker] = await rows(sql`select s.id,s.file_id,s.label from sticker s join sticker_pack p on p.id=s.pack_id where s.id=${input.stickerId} and p.active for share of p`, tx);
      if (!sticker) throw new HttpError(400, "Стикер больше недоступен");
      type = "sticker";
      content = messageTypes.sticker.validate.parse({ text: sticker.label, stickerId: sticker.id, fileId: sticker.file_id });
    }
    if (input.forwardId) {
      const [source] = await rows(
        sql`select m.*,u.name from message m join "user" u on u.id=m.author_id join chat_member cm on cm.chat_id=m.chat_id and cm.user_id=${u.id} where m.id=${input.forwardId} and m.deleted_at is null for share of m`,
        tx,
      );
      if (!source)
        throw new HttpError(403, "Нет доступа к исходному сообщению");
      content = source.content;
      type = source.type;
      forwarded = source.forwarded_from ?? {
        authorId: source.author_id,
        authorName: source.name,
      };
    }
    if (input.replyToId) {
      const [r] = await rows(
        sql`select id from message where id=${input.replyToId} and chat_id=${chatId} and deleted_at is null`,
        tx,
      );
      if (!r) throw new HttpError(400, "Сообщение для ответа недоступно");
    }
    if (!input.forwardId && ["text", "photo", "file", "video"].includes(type)) {
      // Validators trim text; shift UTF-16 offsets by the removed leading whitespace.
      const offset = input.text.length - input.text.trimStart().length;
      content.mentions = await validateMentions(tx, chatId, content.text, input.mentions?.map(m=>({...m,start:m.start-offset})));
    }
    const id = v7();
    await tx.execute(
      sql`insert into message(id,chat_id,author_id,client_message_id,type,content,reply_to_id,forwarded_from) values(${id},${chatId},${u.id},${input.clientMessageId},${type},${JSON.stringify(content)}::jsonb,${input.replyToId ?? null},${forwarded ? JSON.stringify(forwarded) : null}::jsonb)`,
    );
    await tx.execute(sql`update chat set updated_at=now() where id=${chatId}`);
    if (notify) await event(tx, chatId);
    // The message and its per-device push jobs commit together. Replays return above.
    await tx.execute(sql`insert into push_delivery(subscription_id,message_id)
      select ps.id,${id} from push_subscription ps
      join chat_member cm on cm.user_id=ps.user_id and cm.chat_id=${chatId}
      join "user" recipient on recipient.id=ps.user_id and not recipient.banned
      join session s on s.id=ps.session_id and s.expires_at>now()
      left join notification_preference np on np.user_id=ps.user_id
      left join chat_notification_preference cp on cp.user_id=ps.user_id and cp.chat_id=${chatId}
      where ps.user_id<>${u.id} and coalesce(np.enabled,true) and not coalesce(cp.muted,false)
      for key share of ps
      on conflict do nothing`);
    return { id, ...(input.attachment ? { attachmentId: input.attachment.id } : {}), ...(input.recording ? { recordingId: input.recording.id } : {}), ...(input.photos ? { photoIds: input.photos.map(photo => photo.id) } : {}) };
  };
  return transaction ? run(transaction) : db.transaction(run);
}
