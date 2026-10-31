import { Button } from "./app-button";
import { useState } from "react";

export function About() {
  const [status, setStatus] = useState("");
  const [checking, setChecking] = useState(false);
  const version = import.meta.env.VITE_APP_VERSION;
  const build = import.meta.env.VITE_SHELL_VERSION ?? "dev";
  const builtAt = import.meta.env.VITE_BUILD_TIME;
  const mode = import.meta.env.PROD ? "Готовая сборка" : "Разработка";
  const details = `Beacon ${version}\nСборка: ${build}\nДата сборки: ${builtAt}\nРежим: ${mode}`;
  return <section aria-label="Информация о приложении">
    <h2>Beacon</h2>
    <dl className="about-details">
      <div><dt>Версия</dt><dd>{version}</dd></div>
      <div><dt>Номер сборки</dt><dd>{build}</dd></div>
      <div><dt>{import.meta.env.PROD ? "Дата сборки" : "Запуск интерфейса"}</dt><dd><time dateTime={builtAt}>{new Date(builtAt).toLocaleString("ru-RU")}</time></dd></div>
      <div><dt>Режим</dt><dd>{mode}</dd></div>
    </dl>
    <div className="about-actions">
      <Button type="button" className="secondary-button" onClick={async () => {
        try { await navigator.clipboard.writeText(details); setStatus("Информация скопирована."); }
        catch { setStatus("Не удалось скопировать. Можно выделить данные выше вручную."); }
      }}>Скопировать информацию</Button>
      <Button type="button" className="secondary-button" disabled={checking} onClick={async () => {
        if (!import.meta.env.PROD) { setStatus("В режиме разработки изменения загружаются автоматически."); return; }
        setChecking(true);
        try {
          const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
          if (!registration) { setStatus("Обновление ещё не настроено. Попробуйте после перезагрузки приложения."); return; }
          await registration.update();
          setStatus(registration.waiting ? "Доступно обновление. Нажмите «Обновить» в уведомлении приложения." : registration.installing ? "Новая сборка загружается. После загрузки появится предложение обновить приложение." : "Проверка завершена. Новая сборка не обнаружена.");
        } catch { setStatus("Не удалось проверить обновления. Проверьте подключение к интернету."); }
        finally { setChecking(false); }
      }}>{checking ? "Проверяем…" : "Проверить обновления"}</Button>
    </div>
    <p role="status">{status}</p>
  </section>;
}
