"use client";
import { useEffect, useState } from "react";
import { ApiError } from "./ui";
import { Icon } from "./icon";
import { pushErrorMessage } from "./push-errors";
type Settings = { configured: boolean; publicKey: string | null; enabled: boolean; showPreview: boolean; mutedChatIds: string[] };
export async function pushApi<T = any>(path = "", method = "GET", data?: unknown): Promise<T> {
  const response = await fetch(`/api/push${path}`, {method,cache:"no-store",signal:AbortSignal.timeout(15000),
    headers:data ? {"Content-Type":"application/json"} : undefined,body:data ? JSON.stringify(data) : undefined});
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error || "Не удалось настроить уведомления",response.status);
  return body;
}
export async function pushWorker() {
  await navigator.serviceWorker.register("/sw.js", {updateViaCache:"none"});
  let timer:ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>reject(new Error("Не удалось подготовить уведомления. Обновите страницу.")),15000);
    })]);
  } finally { clearTimeout(timer!); }
}
function applicationKey(value: string) {
  const raw = atob(value.replace(/-/g,"+").replace(/_/g,"/") + "=".repeat((4-value.length%4)%4));
  const bytes = new Uint8Array(raw.length);
  for (let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
  return bytes;
}
function sameKey(subscription: PushSubscription, key: string) {
  const actual = new Uint8Array(subscription.options.applicationServerKey ?? new ArrayBuffer(0));
  const expected = applicationKey(key);
  return actual.length === expected.length && actual.every((value,index) => value === expected[index]);
}
export async function forgetPushDevice() {
  if (!("serviceWorker" in navigator)) return;
  const worker = await navigator.serviceWorker.getRegistration("/");
  const subscription = await worker?.pushManager?.getSubscription();
  if (subscription) await subscription.unsubscribe();
  if (worker) for (const notification of await worker.getNotifications()) notification.close();
}
export async function syncPushDevice() {
  if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator) || Notification.permission!=="granted") return;
  const settings=await pushApi<Settings>();
  if (!settings.publicKey) return;
  const worker=await pushWorker();
  const subscription=await worker.pushManager.getSubscription();
  if (subscription && sameKey(subscription,settings.publicKey)) {
    try { await pushApi("/subscriptions","POST",subscription.toJSON()); }
    catch(e) { if (!(e instanceof ApiError && e.status===409)) throw e; }
  }
}
export function PushSettings({notify}:{notify:(error:unknown)=>void}) {
  const [settings,setSettings] = useState<Settings|null>(null);
  const [supported,setSupported] = useState(false), [installed,setInstalled] = useState(true);
  const [permission,setPermission] = useState<NotificationPermission>("default");
  const [active,setActive] = useState(false), [busy,setBusy] = useState(false);
  const [brave,setBrave] = useState(false);
  useEffect(() => {
    const browser = navigator as Navigator & {brave?:{isBrave?:()=>Promise<boolean>}};
    void browser.brave?.isBrave?.().then(setBrave).catch(()=>{});
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints>1);
    const standalone = matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & {standalone?:boolean}).standalone;
    setInstalled(!ios || standalone);
    const available = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
    setSupported(available);
    if (available) setPermission(Notification.permission);
    void (async () => {
      const config = await pushApi<Settings>(); setSettings(config);
      if (!available || !config.publicKey || Notification.permission!=="granted") return;
      const worker = await pushWorker();
      const subscription = await worker.pushManager.getSubscription();
      if (subscription && sameKey(subscription,config.publicKey)) {
        try { await pushApi("/subscriptions","POST",subscription.toJSON());setActive(true); }
        catch (e) { if (!(e instanceof ApiError && e.status===409)) throw e; }
      }
    })().catch(notify);
  }, []);
  async function enable() {
    setBusy(true);
    try {
      // Preserve user activation for the permission prompt, especially on iOS.
      const permission = await Notification.requestPermission(); setPermission(permission);
      if (permission!=="granted") return;
      const worker = await pushWorker();
      let subscription = await worker.pushManager.getSubscription();
      if (subscription) {
        await pushApi("/subscriptions","DELETE",{endpoint:subscription.endpoint});
        await subscription.unsubscribe(); subscription=null;
      }
      subscription=await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(settings!.publicKey!)});
      try { await pushApi("/subscriptions","POST",subscription.toJSON()); }
      catch(e) { await subscription.unsubscribe();throw e; }
      if (!settings!.enabled) setSettings(await pushApi<Settings>("","PATCH",{enabled:true,showPreview:settings!.showPreview}));
      setActive(true);
    } catch(e) { notify(new Error(pushErrorMessage(e,brave))); } finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true);
    try {
      const worker = await pushWorker();
      const subscription = await worker.pushManager.getSubscription();
      if (subscription) {
        await pushApi("/subscriptions","DELETE",{endpoint:subscription.endpoint});
        await subscription.unsubscribe();
      }
      for (const notification of await worker.getNotifications()) notification.close();
      setActive(false);
    } catch(e) { notify(e); } finally { setBusy(false); }
  }
  async function save(patch:Partial<Settings>) {
    const previous=settings!;
    const next={...previous,...patch};
    setSettings(next);
    setBusy(true);
    try { setSettings(await pushApi<Settings>("","PATCH",{enabled:next.enabled,showPreview:next.showPreview})); }
    catch(e) { setSettings(previous);notify(e); } finally { setBusy(false); }
  }
  return <section className="settings-card"><h2>Push-уведомления</h2>
    <p className="field-note">Новые сообщения, даже когда Beacon закрыт. Уведомления включаются отдельно на каждом устройстве.</p>
    {!installed ? <p className="field-note">На iPhone и iPad сначала добавьте Beacon на экран «Домой» через меню «Поделиться», затем откройте установленное приложение.</p>
      : !supported ? <p className="field-note">Этот браузер не поддерживает push-уведомления. Попробуйте современный браузер.</p>
      : !settings ? <p className="field-note">Загружаем настройки…</p>
      : !settings.configured ? <p className="field-note">Уведомления пока не настроены на сервере.</p>
      : <>
        <p className="field-note" role="status">{permission==="denied" ? "Уведомления запрещены. Разрешите их в настройках сайта в браузере." : active ? "На этом устройстве включены" : "На этом устройстве выключены"}</p>
        {brave && !active && <p className="field-note">В Brave для push нужен включённый параметр «Use Google services for push messaging» в настройках конфиденциальности: <code>brave://settings/privacy</code>.</p>}
        <button className="secondary-button" disabled={busy || (permission==="denied" && !active)} onClick={() => void (active ? disable() : enable())}>
          {busy ? "Сохраняем…" : active ? "Отключить на этом устройстве" : "Включить уведомления"}
        </button>
        <label className="check-row"><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={e=>void save({enabled:e.target.checked})}/>Получать push на всех подключённых устройствах</label>
        <label className="check-row"><input type="checkbox" checked={settings.showPreview} disabled={busy} onChange={e=>void save({showPreview:e.target.checked})}/>Показывать имя отправителя и текст сообщения</label>
      </>}
  </section>;
}
export function ChatPushToggle({chatId,notify}:{chatId:string;notify:(error:unknown)=>void}) {
  const [muted,setMuted]=useState<boolean|null>(null),[busy,setBusy]=useState(false);
  useEffect(()=>{let live=true;setMuted(null);void pushApi<Settings>().then(s=>{if(live)setMuted(s.mutedChatIds.includes(chatId))}).catch(notify);return()=>{live=false}},[chatId]);
  return <button className="icon-button" disabled={muted===null || busy} aria-label={muted ? "Включить push в этом чате" : "Отключить push в этом чате"} title={muted ? "Включить push в этом чате" : "Отключить push в этом чате"} aria-pressed={muted ?? false}
    onClick={async()=>{setBusy(true);try{await pushApi(`/chats/${chatId}`,"PATCH",{muted:!muted});setMuted(!muted)}catch(e){notify(e)}finally{setBusy(false)}}}>
    <Icon name={muted ? "bellOff" : "bell"}/>
  </button>;
}
