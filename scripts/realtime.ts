import { v7 } from "uuid";
import { presenceHeartbeat, releasePresence } from "../apps/api/src/modules/presence";
import { cleanupMediaBatch } from "../apps/api/src/modules/media/cleanup";
import { publishActivity } from "../apps/api/src/modules/chat/activity";
import { createServer } from "node:http";
import { Server } from "socket.io";
import pg from "pg";
import { auth } from "../apps/api/src/modules/auth/config";
import { actor } from "../apps/api/src/lib/http";
import { db, pool } from "../apps/api/src/db";
import { sql } from "drizzle-orm";
import { rows } from "../apps/api/src/modules/chat/service";
import { deliverPushBatch } from "../apps/api/src/modules/push/worker";
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
  const presenceId=v7();
  socket.emit("presence.connection",{id:presenceId});
  let presenceAt=0,presenceRunning=false,presencePending:boolean|undefined;
  let presenceTimer:ReturnType<typeof setTimeout>|undefined;
  const schedulePresence=()=>{
    if(presenceRunning||presenceTimer||presencePending===undefined||!socket.connected)return;
    presenceTimer=setTimeout(async()=>{
      presenceTimer=undefined;if(presencePending===undefined||!socket.connected)return;
      const visible=presencePending;presencePending=undefined;presenceAt=Date.now();presenceRunning=true;
      try{await presenceHeartbeat(socket.data.headers,presenceId,visible);}catch{/* Revoked sessions never gain presence. */}
      finally{presenceRunning=false;if(!socket.connected)await releasePresence(presenceId).catch(()=>{});else schedulePresence();}
    },Math.max(0,1000-(Date.now()-presenceAt)));
  };
  socket.on("presence.heartbeat",(input:unknown)=>{
    if(!input||typeof input!=="object"||typeof (input as {visible?:unknown}).visible!=="boolean")return;
    presencePending=(input as {visible:boolean}).visible;schedulePresence();
  });
  socket.on("disconnect",()=>{clearTimeout(presenceTimer);void releasePresence(presenceId).catch(()=>{});});
  let last = 0, active: {chatId:string;kind:string|null} | undefined, running = false;
  socket.on("chat.activity", async (input: unknown) => {
    if (running || Date.now()-last<400) return;
    last=Date.now(); running=true;
    try {
      const value = await publishActivity(socket.data.headers,input,socket.id);
      if (active && active.chatId!==value.chatId) await publishActivity(socket.data.headers,{chatId:active.chatId,kind:null},socket.id);
      active=value;
      if (!socket.connected) await publishActivity(socket.data.headers,{chatId:value.chatId,kind:null},socket.id);
    } catch { /* Unauthorized, malformed and stale activity is simply discarded. */ }
    finally { running=false; }
  });
  socket.on("disconnect", () => { if (active) void publishActivity(socket.data.headers,{chatId:active.chatId,kind:null},socket.id).catch(()=>{}); });
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
      if(e.kind==="presence.changed")io.emit("presence.changed",{userId:e.profileUserId});
      else if (e.kind === "user.revoked")
        io.in(`user:${e.userId}`).disconnectSockets(true);
      else if (e.kind === "profile.changed")
        io.to(`user:${e.userId}`).emit("profile.changed", { userId: e.profileUserId });
      else if (e.kind === "chat.activity") io.to(`user:${e.userId}`).volatile.emit("chat.activity",e.activity);
      else if(e.kind === "draft.changed")io.to(`user:${e.userId}`).emit("draft.changed",{chatId:e.chatId});
      else if (e.kind === "receipt.changed") io.to(`user:${e.userId}`).emit("receipt.changed",{chatId:e.chatId});
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
        sql`select * from outbox where processed_at is null and kind<>'media.cleanup' order by created_at,id limit 50 for update skip locked`,
        tx,
      );
      for (const item of batch) {
        const payload = item.payload;
        const ids = payload.blockedUserId
          ? [payload.blockedUserId]
          : (payload.userIds ?? []);
        for (const userId of ids)
          await tx.execute(
            sql`select pg_notify('beacon_events',${JSON.stringify({ kind: item.kind, userId, chatId: payload.chatId, profileUserId: payload.profileUserId })})`,
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
let cleaningMedia: Promise<void> | undefined;
const mediaTimer = setInterval(() => {
  if (cleaningMedia) return;
  cleaningMedia = cleanupMediaBatch().catch(() => console.error("ERROR media cleanup deferred")).finally(() => { cleaningMedia=undefined; });
},5000);
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
    await db.execute(sql`delete from presence_lease where expires_at<now()-interval '1 day'`);
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
  clearInterval(mediaTimer);
  await cleaningMedia;
  await pushing;
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await listener?.end().catch(() => {});
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
