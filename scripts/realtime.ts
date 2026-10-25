import { createServer } from "node:http";
import { Server } from "socket.io";
import pg from "pg";
import { auth } from "../src/modules/auth/config";
import { actor } from "../src/lib/http";
import { db, pool } from "../src/db";
import { sql } from "drizzle-orm";
import { rows } from "../src/modules/chat/service";
import { deliverPushBatch } from "../src/modules/push/worker";
const http = createServer((_, res) => {
  res.writeHead(200);
  res.end("ok");
});
const origin = new URL(process.env.APP_URL!).origin;
const io = new Server(http, {
  cors: { origin, credentials: true },
  allowRequest: (req, done) => {
    // Same-origin polling requests may omit Origin; WebSocket requests include it.
    const allowed = req.headers.origin
      ? req.headers.origin === origin
      : req.headers.host === new URL(origin).host &&
        req.headers["sec-fetch-site"] !== "cross-site";
    done(null, allowed);
  },
});
io.use(async (socket, next) => {
  try {
    const headers = new Headers();
    if (socket.request.headers.cookie)
      headers.set("cookie", socket.request.headers.cookie);
    const u = await actor(headers);
    if (!u.firstName || !u.lastName) throw new Error();
    socket.data.userId = u.id;
    socket.data.headers = headers;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});
io.on("connection", (socket) => {
  socket.join(`user:${socket.data.userId}`);
});
let stopped = false;
let listener: pg.Client | undefined;
async function listen() {
  if (stopped) return;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  listener = client;
  let retrying = false;
  const retry = () => {
    if (retrying || stopped) return;
    retrying = true;
    client.end().catch(() => {});
    setTimeout(() => void listen(), 1500);
  };
  client.on("error", retry);
  client.on("end", retry);
  client.on("notification", (n) => {
    try {
      const e = JSON.parse(n.payload!);
      if (e.kind === "user.revoked")
        io.in(`user:${e.userId}`).disconnectSockets(true);
      else io.to(`user:${e.userId}`).emit("chat.changed", { chatId: e.chatId });
    } catch {
      console.error("ERROR invalid realtime event");
    }
  });
  try {
    await client.connect();
    await client.query("LISTEN beacon_events");
  } catch {
    retry();
  }
}
let dispatching = false;
const dispatch = setInterval(async () => {
  if (dispatching) return;
  dispatching = true;
  try {
    await db.transaction(async (tx) => {
      const batch = await rows(
        sql`select * from outbox where processed_at is null order by created_at,id limit 50 for update skip locked`,
        tx,
      );
      for (const item of batch) {
        const payload = item.payload;
        const ids = payload.blockedUserId
          ? [payload.blockedUserId]
          : (payload.userIds ?? []);
        for (const userId of ids)
          await tx.execute(
            sql`select pg_notify('beacon_events',${JSON.stringify({ kind: item.kind, userId, chatId: payload.chatId })})`,
          );
        await tx.execute(
          sql`update outbox set processed_at=now() where id=${item.id}`,
        );
      }
    });
  } catch {
    console.error("ERROR event delivery will retry");
  } finally {
    dispatching = false;
  }
}, 250);
let pushing: Promise<void> | undefined;
const pushTimer = setInterval(() => {
  if (pushing) return;
  pushing = deliverPushBatch().catch(() => {
    console.error("ERROR push delivery deferred");
  }).finally(() => { pushing = undefined; });
}, 1000);
const validate = setInterval(async () => {
  for (const socket of io.sockets.sockets.values()) {
    try {
      await actor(socket.data.headers);
    } catch {
      socket.disconnect(true);
    }
  }
  // Reconciliation also covers a lost PostgreSQL notification without exposing content.
  io.emit("sync");
}, 15000);
const clean = setInterval(async () => {
  try {
    await db.execute(
      sql`delete from outbox where processed_at<now()-interval '7 days'`,
    );
    await db.execute(
      sql`delete from verification where expires_at<now()-interval '1 day'`,
    );
    await db.execute(
      sql`delete from oauth_client_assertion where expires_at<now()`,
    );
    await db.execute(sql`delete from push_subscription where session_id in (select id from session where expires_at<now())`);
    await db.execute(sql`delete from push_delivery where coalesce(completed_at,created_at)<now()-interval '7 days'`);
  } catch {
    console.error("ERROR cleanup deferred");
  }
}, 3600000);
await listen();
http.listen(3001, "0.0.0.0", () => console.log("INFO realtime ready"));
async function stop() {
  stopped = true;
  clearInterval(dispatch);
  clearInterval(validate);
  clearInterval(clean);
  clearInterval(pushTimer);
  await pushing;
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await listener?.end().catch(() => {});
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
