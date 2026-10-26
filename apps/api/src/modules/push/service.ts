import { sql } from "drizzle-orm";
import { db } from "../../db";
import { rows, member, writable, type Actor } from "../chat/service";
import { HttpError } from "../../lib/http";
import { pushConfiguration, subscriptionInput } from "./config";

export async function settings(userId: string) {
  const [prefs] = await rows(sql`select enabled,show_preview as "showPreview" from notification_preference where user_id=${userId}`);
  const muted = await rows(sql`select cp.chat_id from chat_notification_preference cp join chat_member cm on cm.chat_id=cp.chat_id and cm.user_id=cp.user_id where cp.user_id=${userId} and cp.muted`);
  return { configured: !!pushConfiguration(), publicKey: pushConfiguration()?.publicKey ?? null,
    enabled: prefs?.enabled ?? true, showPreview: prefs?.showPreview ?? false,
    mutedChatIds: muted.map((row) => row.chat_id) as string[] };
}

export async function subscribe(u: Actor, sessionId: string, data: unknown) {
  if (!pushConfiguration()) throw new HttpError(503, "Push-уведомления пока не настроены на сервере");
  const input = subscriptionInput.parse(data);
  return db.transaction(async (tx) => {
    await writable(tx, u);
    // Serialize this capability across account changes, as well as per-user limits.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.endpoint},1))`);
    const [existing] = await rows(sql`select id,user_id from push_subscription where endpoint=${input.endpoint}`, tx);
    if (existing && existing.user_id !== u.id)
      throw new HttpError(409, "Подписка относится к другому аккаунту. Включите уведомления заново");
    if (!existing) {
      const [count] = await rows(sql`select count(*)::int as n from push_subscription where user_id=${u.id}`, tx);
      if (count.n >= 20) throw new HttpError(409, "Достигнут лимит устройств с уведомлениями");
    }
    const [saved] = await rows(sql`insert into push_subscription(user_id,session_id,endpoint,p256dh,auth)
      values(${u.id},${sessionId},${input.endpoint},${input.keys.p256dh},${input.keys.auth})
      on conflict(endpoint) do update set session_id=excluded.session_id,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=now()
      returning id`, tx);
    return { id: saved.id };
  });
}

export async function mute(u: Actor, chatId: string, muted: boolean) {
  await db.transaction(async (tx) => {
    await writable(tx, u);
    await member(chatId, u, tx, true);
    await tx.execute(sql`insert into chat_notification_preference(user_id,chat_id,muted) values(${u.id},${chatId},${muted})
      on conflict(user_id,chat_id) do update set muted=excluded.muted`);
  });
}

// Recheck authorization both before delivery and when the device receives the push.
export async function notification(subscriptionId: string, messageId: string, userId?: string, sessionId?: string) {
  const [row] = await rows(sql`select ps.id as "subscriptionId",ps.user_id as "userId",ps.endpoint,ps.p256dh,ps.auth,
    m.id as "messageId",m.chat_id as "chatId",coalesce(nullif(m.content->>'text',''),case when m.type='photo' then 'Фото' when m.type='video' then 'Видео: ' || (m.content->>'name') when m.type='file' then 'Файл: ' || (m.content->>'name') end) as text,author.name as "authorName",c.kind,c.title,
    coalesce(np.show_preview,false) as "showPreview"
    from push_subscription ps join session s on s.id=ps.session_id and s.expires_at>now()
    join "user" recipient on recipient.id=ps.user_id and not recipient.banned
    join message m on m.id=${messageId} and m.deleted_at is null and m.author_id<>ps.user_id and m.created_at>now()-interval '24 hours'
    join chat_member cm on cm.chat_id=m.chat_id and cm.user_id=ps.user_id and m.created_at>cm.last_read_at
    join chat c on c.id=m.chat_id join "user" author on author.id=m.author_id
    left join notification_preference np on np.user_id=ps.user_id
    left join chat_notification_preference cp on cp.user_id=ps.user_id and cp.chat_id=m.chat_id
    where ps.id=${subscriptionId} and coalesce(np.enabled,true) and not coalesce(cp.muted,false)
    ${userId ? sql`and ps.user_id=${userId}` : sql``} ${sessionId ? sql`and ps.session_id=${sessionId}` : sql``}`);
  return row ?? null;
}

export function visibleNotification(row: Record<string, any>) {
  return {
    title: row.showPreview ? (row.kind === "group" ? row.title : row.authorName) || "Beacon" : "Beacon",
    body: row.showPreview
      ? `${row.kind === "group" ? `${row.authorName}: ` : ""}${String(row.text ?? "Новое сообщение").slice(0,180)}`
      : "Новое сообщение. Откройте переписку, чтобы прочитать.",
    chatId: row.chatId as string,
  };
}
