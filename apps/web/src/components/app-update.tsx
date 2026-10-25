import { useEffect, useRef, useState } from "react";

export function AppUpdate() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [available, setAvailable] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const reloadOnChange = useRef(false);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let live = true;
    let workerRegistration: ServiceWorkerRegistration | undefined;
    let lastCheck = 0;
    const listeners: (() => void)[] = [];
    const version = import.meta.env.VITE_SHELL_VERSION;
    const report = () => navigator.serviceWorker.controller?.postMessage({ type: "beacon:client-version", version });
    const changed = () => {
      report();
      if (reloadOnChange.current) location.reload();
    };
    const message = (event: MessageEvent) => {
      if (event.origin !== location.origin) return;
      if (["beacon:version-query", "beacon:active-version"].includes(event.data?.type)) {
        if (event.data.version && event.data.version !== version) setAvailable(true);
        if (event.data.type === "beacon:version-query")
          event.source?.postMessage({ type: "beacon:client-version", version });
      }
    };
    const check = () => {
      report();
      if (!document.hidden && workerRegistration && Date.now() - lastCheck > 60_000) {
        lastCheck = Date.now();
        void workerRegistration.update().catch(() => {});
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    navigator.serviceWorker.addEventListener("message", message);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(reg => {
      if (!live) return;
      workerRegistration = reg;
      setRegistration(reg);
      const waiting = () => { if (reg.waiting && navigator.serviceWorker.controller) setAvailable(true); };
      const watch = () => {
        const worker = reg.installing;
        if (worker) {
          worker.addEventListener("statechange", waiting);
          listeners.push(() => worker.removeEventListener("statechange", waiting));
        }
      };
      reg.addEventListener("updatefound", watch);
      listeners.push(() => reg.removeEventListener("updatefound", watch));
      watch(); waiting(); report();
    }).catch(() => {});
    return () => {
      live = false;
      listeners.forEach(remove => remove());
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      navigator.serviceWorker.removeEventListener("message", message);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  useEffect(() => {
    if (!applying) return;
    const timer = setTimeout(() => {
      reloadOnChange.current = false;
      setApplying(false);
      setError("Не удалось обновить приложение. Попробуйте ещё раз.");
    }, 15_000);
    return () => clearTimeout(timer);
  }, [applying]);
  if (!available) return null;
  return <aside className="app-update" role="status">
    <span>{error || "Доступна новая версия Beacon"}</span>
    <button disabled={applying} onClick={() => {
      const event = new Event("beacon:before-update", { cancelable: true });
      if (!window.dispatchEvent(event)) {
        setError("Сохраните или отправьте сообщение перед обновлением.");
        return;
      }
      setError("");
      setApplying(true);
      if (registration?.waiting) {
        reloadOnChange.current = true;
        registration.waiting.postMessage({ type: "beacon:activate-update" });
      } else location.reload();
    }}>{applying ? "Обновляем…" : "Обновить"}</button>
  </aside>;
}
