import { sql } from "drizzle-orm";
import { db } from "../../db";
import { auth } from "../auth/config";
import { actor, HttpError } from "../../lib/http";
import { rows, writable, type Tx } from "../chat/service";
import type { Presence } from "@beacon/shared";
export async function presenceList():Promise<Presence[]> {
  return rows(sql`select u.id as "userId",exists(select 1 from presence_lease p join session s on s.id=p.session_id and s.expires_at>now() where p.user_id=u.id and p.expires_at>now()) as online,
    greatest(u.last_seen_at,(select max(p.seen_at) from presence_lease p where p.user_id=u.id)) as "lastSeenAt"
    from "user" u where not u.banned`);
}
async function online(tx:Tx,userId:string) {
  const [row]=await rows(sql`select exists(select 1 from presence_lease p join session s on s.id=p.session_id and s.expires_at>now() where p.user_id=${userId} and p.expires_at>now()) as online`,tx);
  return Boolean(row.online);
}
// A replaceable lease boundary; database time and per-device rows work across instances.
export async function presenceHeartbeat(headers:Headers,id:string,visible:boolean) {
  const user=await actor(headers);
  const session=await auth.api.getSession({headers});
  if(!session)throw new HttpError(401,"Войдите в приложение");
  await db.transaction(async tx=>{
    await writable(tx,user);const wasOnline=await online(tx,user.id);
    if(visible){
      await tx.execute(sql`insert into presence_lease(id,user_id,session_id,seen_at,expires_at) values(${id},${user.id},${session.session.id},now(),now()+interval '75 seconds') on conflict(id) do update set seen_at=now(),expires_at=now()+interval '75 seconds'`);
    }else await tx.execute(sql`delete from presence_lease where id=${id} and user_id=${user.id}`);
    await tx.execute(sql`update "user" set last_seen_at=greatest(last_seen_at,now()) where id=${user.id} and not banned`);
    const isOnline=await online(tx,user.id);
    if(wasOnline!==isOnline||!isOnline)await tx.execute(sql`select pg_notify('beacon_events',${JSON.stringify({kind:"presence.changed",profileUserId:user.id})})`);
  });
}
export async function releasePresence(id:string) {
  await db.transaction(async tx=>{
    const [owner]=await rows(sql`select user_id from presence_lease where id=${id}`,tx);if(!owner)return;
    // The same user -> lease lock order as heartbeats avoids disconnect/update deadlocks.
    await rows(sql`select id from "user" where id=${owner.user_id} for update`,tx);
    const wasOnline=await online(tx,owner.user_id);
    const leases=await rows(sql`delete from presence_lease where id=${id} returning user_id,seen_at`,tx);
    for(const lease of leases){
      await tx.execute(sql`update "user" set last_seen_at=greatest(last_seen_at,${lease.seen_at}::timestamptz) where id=${lease.user_id}`);
      const isOnline=await online(tx,lease.user_id);
      if(wasOnline!==isOnline||!isOnline)await tx.execute(sql`select pg_notify('beacon_events',${JSON.stringify({kind:"presence.changed",profileUserId:lease.user_id})})`);
    }
  });
}

export async function leavePresence(userId:string,id:string) {
  const [lease]=await rows(sql`select id from presence_lease where id=${id} and user_id=${userId}`);
  if(lease)await releasePresence(id);
}
