import Dexie, { type Table } from "dexie";
import type { User, Chat, Message, Pending, Mention, OfflineSnapshot } from "@beacon/shared";

type CacheRow = { key: string; account: string; value: unknown };
export type LocalDraft = { key: string; account: string; chatId: string; text: string; mentions: Mention[]; dirty: boolean };
type ReadRow = {key:string;account:string;chatId:string;messageId:string;at:string};
type OutboxRow = Pending & { key: string; account: string };
class DeviceDatabase extends Dexie {
  cache!: Table<CacheRow, string>;
  drafts!: Table<LocalDraft, string>;
  outbox!: Table<OutboxRow, string>;
  reads!: Table<ReadRow,string>;
  constructor() {
    super("beacon-device-v1");
    this.version(1).stores({ cache: "key,account", drafts: "key,account", outbox: "key,account", reads:"key,account" });
  }
}
export const deviceDB = new DeviceDatabase();
const marker = "beacon:local-account";
let account: string | undefined, generation = 0;
let disabled = false;
export const localAccount = () => account;
export const localGeneration = () => generation;
const key = (id: string, name: string) => `${id}/${name}`;
export function storageProblem() {
  if(disabled)return;
  disabled = true;
  window.dispatchEvent(new Event("beacon:storage-error"));
}
export const storageUnavailable = () => disabled;
function changed() { window.dispatchEvent(new Event("beacon:device-data")); }
export async function readCache<T>(name: string): Promise<T | undefined> {
  if (!account) return;
  try { return (await deviceDB.cache.get(key(account, name)))?.value as T | undefined; }
  catch { storageProblem(); }
}
export async function writeCache(name: string, value: unknown, owner = account, historyEpoch?: number) {
  if (!owner || owner !== account) return;
  try {
    await deviceDB.transaction("rw",deviceDB.cache,async()=>{
      if(owner!==account)return;
      if(name.startsWith("history/")){
        const chats=(await deviceDB.cache.get(key(owner,"chats")))?.value as Chat[]|undefined;
        const chat=chats?.find(chat=>chat.id===name.slice("history/".length));
        if(!chat||Number((value as OfflineSnapshot)?.historyRevision??0)!==Number(chat.historyRevision??0))return;
        const epoch=(await deviceDB.cache.get(key(owner,"history-epoch")))?.value??0;
        if(historyEpoch!==undefined&&historyEpoch!==epoch)return;
      }
      await deviceDB.cache.put({ key: key(owner, name), account: owner, value });
    });
    changed();
    if(name.startsWith("history/"))window.dispatchEvent(new CustomEvent("beacon:history-updated",{detail:{chatId:name.slice("history/".length)}}));
  } catch { storageProblem(); }
}
export async function restoreAccount() {
  try {
    account = localStorage.getItem(marker) || undefined;
    return await readCache<User>("me");
  } catch { storageProblem(); }
}
export async function acceptAccount(user: User) {
  if (account !== user.id) {
    await forgetAccount();
    account = user.id; generation++;
    try { localStorage.setItem(marker, user.id); } catch { storageProblem(); }
  }
  await writeCache("me", user);
}
export async function forgetAccount() {
  const owner = account;
  account = undefined; generation++;
  // Clear the bootstrap pointer synchronously, before any asynchronous cleanup.
  try { localStorage.removeItem(marker); } catch { /* A blocked store has no bootstrap pointer. */ }
  if (owner) {
    for (const name of [`pending:${owner}`, `update-drafts:${owner}`, `beacon:unsynced-drafts:${owner}`]) {
      try { sessionStorage.removeItem(name); } catch { /* May be unavailable. */ }
    }
    await deviceDB.transaction("rw", deviceDB.cache, deviceDB.drafts, deviceDB.outbox, deviceDB.reads, async () => {
      await deviceDB.cache.where("account").equals(owner).delete();
      await deviceDB.drafts.where("account").equals(owner).delete();
      await deviceDB.outbox.where("account").equals(owner).delete();
      await deviceDB.reads.where("account").equals(owner).delete();
    }).catch(storageProblem);
  }
  changed();
}
// Other tabs must not keep displaying a different account or resurrect its queue.
window.addEventListener("storage", event => {
  if (event.key === marker && event.newValue !== account) {
    account = undefined; generation++;
    window.dispatchEvent(new Event("beacon:account-changed"));
  }
});
export async function reconcileChats(chats: Chat[], owner = account) {
  if (!owner || account !== owner) return;
  const allowed = new Set(chats.map(chat => chat.id));
  try {
    await deviceDB.transaction("rw", deviceDB.cache, deviceDB.drafts, deviceDB.outbox, deviceDB.reads, async () => {
      const previous=(await deviceDB.cache.get(key(owner,"chats")))?.value as Chat[]|undefined;
      chats=chats.map(chat=>({...chat,historyRevision:Math.max(chat.historyRevision??0,previous?.find(old=>old.id===chat.id)?.historyRevision??0)}));
      const rows = await deviceDB.cache.where("account").equals(owner).toArray();
      for (const row of rows) if(row.key.startsWith(key(owner,"history/"))){
        const chat=chats.find(chat=>chat.id===row.key.split("/").at(-1));
        if(!chat||Number((row.value as OfflineSnapshot)?.historyRevision??0)!==Number(chat.historyRevision??0))await deviceDB.cache.delete(row.key);
      }
      for (const table of [deviceDB.drafts, deviceDB.outbox, deviceDB.reads]) {
        const rows = await table.where("account").equals(owner).toArray();
        for (const row of rows) if (!allowed.has(row.chatId)) await table.delete(row.key);
      }
      await deviceDB.cache.put({ key: key(owner, "chats"), account: owner, value: chats });
    });
    changed();
  } catch { storageProblem(); }
}
export async function cachedResponse(path: string): Promise<unknown> {
  if (["me", "chats", "users"].includes(path)) return readCache(path);
  const match = /^chats\/([^/]+)\/messages(?:\?(.*))?$/.exec(path);
  if (!match) return;
  const snapshot = await readCache<OfflineSnapshot>(`history/${match[1]}`);
  const rows=snapshot?.messages;
  if (!rows) return { messages: [], hasMore: false };
  const query = new URLSearchParams(match[2]);
  const cursor = query.get("afterId") || query.get("beforeId");
  let messages = rows;
  if (cursor) {
    const at = query.get(query.has("afterId") ? "afterAt" : "beforeAt") || "";
    const compare = (m: Message) => m.createdAt.localeCompare(at) || m.id.localeCompare(cursor);
    messages = rows.filter(m => query.has("afterId") ? compare(m) >= (query.get("inclusive") === "true" ? 0 : 1) : compare(m) < 0);
  }
  return {messages,hasMore:false,historyRevision:snapshot?.historyRevision??0};
}
export async function localDrafts(owner: string) {
  return deviceDB.drafts.where("account").equals(owner).toArray();
}
export async function saveDraft(owner: string, chatId: string, value: {text: string; mentions: Mention[]}, dirty = true) {
  if (owner !== account) return;
  await deviceDB.drafts.put({key:key(owner,chatId),account:owner,chatId,...value,dirty}); changed();
}
export async function enqueue(owner: string, item: Pending) {
  if (account !== owner) throw new Error("Аккаунт изменился. Войдите повторно.");
  // A failed transaction must leave the composer intact: never claim a durable send.
  await deviceDB.outbox.put({...item,key:key(owner,item.clientMessageId),account:owner}); changed();
}
export async function queued(owner: string): Promise<Pending[]> {
  return (await deviceDB.outbox.where("account").equals(owner).sortBy("clientMessageId"))
    .map(({key: _key, account: _account, ...item}) => item);
}
export async function acknowledge(owner: string, id: string) {
  await deviceDB.outbox.delete(key(owner,id)); changed();
}
export async function clearHistory() {
  const owner = account;
  if (!owner) return;
  await deviceDB.transaction("rw",deviceDB.cache,async()=>{
    await deviceDB.cache.where("account").equals(owner).filter(row=>row.key.startsWith(key(owner,"history/"))).delete();
    const epoch=Number((await deviceDB.cache.get(key(owner,"history-epoch")))?.value??0);
    await deviceDB.cache.put({key:key(owner,"history-epoch"),account:owner,value:epoch+1});
    await deviceDB.cache.put({key:key(owner,"background-paused"),account:owner,value:true});
  });
  window.dispatchEvent(new Event("beacon:history-cleared")); changed();
}
export async function deviceStats() {
  if (!account) return {bytes:0,chats:0,messages:0,drafts:0,queued:0,paused:false};
  const [rows,drafts,outbox] = await Promise.all([deviceDB.cache.where("account").equals(account).toArray(), localDrafts(account), queued(account)]);
  const history=rows.filter(row=>row.key.startsWith(key(account!,"history/")));
  return {bytes:new Blob([JSON.stringify([rows,drafts,outbox])]).size,chats:history.length,
    messages:history.reduce((sum,row)=>sum+(row.value as OfflineSnapshot).messages.length,0),drafts:drafts.filter(d=>d.text.length).length,queued:outbox.length,
    paused:rows.some(row=>row.key===key(account!,"background-paused")&&row.value===true)};
}

export async function rememberRead(owner:string,chatId:string,message:Message) {
  if(owner!==account)return;
  await deviceDB.transaction("rw",deviceDB.reads,async()=>{
    const id=key(owner,chatId),previous=await deviceDB.reads.get(id);
    if(!previous||previous.at<message.createdAt)await deviceDB.reads.put({key:id,account:owner,chatId,messageId:message.id,at:message.createdAt});
  });
}
export async function pendingReads(owner:string) {return deviceDB.reads.where("account").equals(owner).toArray();}
export async function acknowledgeRead(owner:string,chatId:string,messageId:string) {
  await deviceDB.transaction("rw",deviceDB.reads,async()=>{
    const id=key(owner,chatId),row=await deviceDB.reads.get(id);
    if(row?.messageId===messageId)await deviceDB.reads.delete(id);
  });
}
