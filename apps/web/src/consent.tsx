import { useState } from "react";
import { authClient } from "@/auth-client";
export default function Consent() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function answer(accept: boolean) {
    setBusy(true);
    try {
      const r = await authClient.oauth2.consent({ accept });
      if (r.error) throw new Error("Не удалось подтвердить доступ");
      if (r.data?.url) window.location.assign(r.data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell" style={{ height: "100dvh" }}>
      <section className="auth-card">
        <h1>Вход в подключённый сервис</h1>
        <p className="auth-lead">
          Сервис запрашивает разрешение получить данные вашего аккаунта в
          соответствии с настроенными областями доступа.
        </p>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <div className="inline-actions">
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void answer(true)}
          >
            Разрешить
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void answer(false)}
          >
            Отказать
          </button>
        </div>
      </section>
    </main>
  );
}
