import { useEffect, useState } from "react";
import { fileSize } from "@beacon/shared";
import { clearHistory, deviceStats, storageUnavailable, writeCache } from "../offline";
export function DeviceData({notify}:{notify:(error:unknown)=>void}) {
  const [stats,setStats]=useState<Awaited<ReturnType<typeof deviceStats>>|null>(null);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    const refresh=()=>void deviceStats().then(setStats).catch(notify);
    refresh();window.addEventListener("beacon:device-data",refresh);
    return()=>window.removeEventListener("beacon:device-data",refresh);
  },[]);
  return <section className="settings-card"><h2>Данные на устройстве</h2>
    <p>В каждом чате сохраняются последние 100 прочитанных сообщений и до 1000 непрочитанных. Они доступны без интернета. Фото, видео и файлы пока не загружаются для офлайн-доступа.</p>
    <p>Фоновая загрузка работает, пока приложение открыто. Сначала обновляется открытый чат, затем остальные — начиная с недавних.</p>
    {storageUnavailable()?<p role="alert">Браузер не разрешает сохранять данные. Офлайн-доступ недоступен.</p>:stats&&<>
      <dl className="device-data-stats"><dt>Локальные данные</dt><dd>≈ {fileSize(stats.bytes)}</dd><dt>Сохранённые чаты</dt><dd>{stats.chats}</dd><dt>Сообщения</dt><dd>{stats.messages}</dd><dt>Черновики</dt><dd>{stats.drafts}</dd><dt>В очереди отправки</dt><dd>{stats.queued}</dd></dl>
      <button className="secondary-button" disabled={busy||!stats.messages} onClick={async()=>{setBusy(true);try{await clearHistory();}catch(error){notify(error);}finally{setBusy(false);}}}>Очистить загруженную переписку</button>
      <p>Черновики и неотправленные сообщения сохранятся. После очистки фоновая загрузка приостановится; открываемые чаты продолжат сохраняться.</p>
      {stats.paused&&<button className="secondary-button" onClick={()=>void writeCache("background-paused",false).then(()=>window.dispatchEvent(new Event("beacon:resume-download")))}>Возобновить фоновую загрузку</button>}
    </>}
    <p>Данные хранятся в этом браузере. При выходе из аккаунта они удаляются. Очистка данных браузера также удалит черновики и очередь.</p>
  </section>;
}
