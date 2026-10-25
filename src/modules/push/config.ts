import { ECDH } from "node:crypto";
import { z } from "zod";

export function pushConfiguration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || process.env.APP_URL! };
}

export const subscriptionInput = z.object({
  endpoint: z.string().max(4096).url().refine((value) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port) return false;
    const host = url.hostname;
    // Never let an authenticated subscription turn the sender into an arbitrary HTTP proxy.
    return host === "fcm.googleapis.com" || host === "web.push.apple.com" ||
      host.endsWith(".push.apple.com") || host.endsWith(".push.services.mozilla.com") ||
      host.endsWith(".notify.windows.com");
  }, "Неподдерживаемый адрес push-службы"),
  keys: z.object({
    auth: z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).max(32).refine((value) => Buffer.from(value, "base64url").length === 16),
    p256dh: z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).max(128).refine((value) => {
      try {
        const key = Buffer.from(value, "base64url");
        return key.length === 65 && ECDH.convertKey(key, "prime256v1").length === 65;
      } catch { return false; }
    }),
  }),
});
