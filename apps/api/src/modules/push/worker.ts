import webpush from "web-push";
import {deliverCallPushBatch} from './calls';
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { rows } from "../chat/service";
import { notification } from "./service";
import { pushConfiguration } from "./config";

export type PushTransport = (subscription: webpush.PushSubscription, payload: string,
  options: webpush.RequestOptions) => Promise<unknown>;

export async function deliverPushBatch(transport: PushTransport = webpush.sendNotification) {
  const config = pushConfiguration();
  if (!config) return;
  await deliverCallPushBatch(transport);
  const batch = await rows(sql`update push_delivery d set lease_until=now()+interval '60 seconds',attempts=d.attempts+1
    from (select id from push_delivery where completed_at is null and next_attempt_at<=now()
      and (lease_until is null or lease_until<now()) order by next_attempt_at,id limit 10 for update skip locked) candidate
    where d.id=candidate.id returning d.*`);
  await Promise.all(batch.map(async (job) => {
    try {
      const record = await notification(job.subscription_id, job.message_id);
      if (!record) {
        await db.execute(sql`update push_delivery set completed_at=now(),outcome='skipped',lease_until=null where id=${job.id}`);
        return;
      }
      // No message text, names or endpoint secrets in the queued payload or logs.
      await transport({ endpoint: record.endpoint, keys: { p256dh: record.p256dh, auth: record.auth } },
        JSON.stringify({ type: "message", subscriptionId: record.subscriptionId, userId: record.userId,
          messageId: record.messageId, chatId: record.chatId }), {
          vapidDetails: config, TTL: 86400, urgency: "normal", timeout: 10000,
          topic: createHash("sha256").update(record.chatId).digest("base64url").slice(0,32),
        });
      await db.execute(sql`update push_delivery set completed_at=now(),outcome='sent',lease_until=null where id=${job.id}`);
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.execute(sql`delete from push_subscription where id=${job.subscription_id}`);
        return;
      }
      const expired = job.attempts >= 6 || Date.now() - new Date(job.created_at).getTime() > 86400000;
      const retry = Math.min(3600, 5 * 2 ** job.attempts);
      await db.execute(sql`update push_delivery set lease_until=null,
        next_attempt_at=now()+${retry}*interval '1 second',
        completed_at=${expired ? new Date() : null},outcome=${expired ? "failed" : "retry"} where id=${job.id}`);
    }
  }));
}
