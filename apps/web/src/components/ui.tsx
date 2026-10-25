import { useState, useEffect, useRef, type ReactNode } from "react";
export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/v1/${path}`, {
      signal: controller.signal,
      method,
      headers: data ? { "Content-Type": "application/json" } : undefined,
      body: data ? JSON.stringify(data) : undefined,
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 401)
        window.dispatchEvent(new Event("beacon:unauthorized"));
      throw new ApiError(body.error ?? "Не удалось выполнить запрос", response.status);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}
export function Avatar({
  name,
  image,
  extra = "",
}: {
  name: string;
  image?: string;
  extra?: string;
}) {
  return image ? (
    <img className={`avatar ${extra}`} src={image} alt={name} />
  ) : (
    <span className={`avatar ${extra}`}>
      {name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()}
    </span>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function AvatarPicker({
  userId,
  chatId,
  done,
  notify,
}: {
  userId?: string;
  chatId?: string;
  done: () => Promise<void>;
  notify: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Field label="Изменить аватар · PNG, JPEG, WebP до 5 МБ">
      <input
        type="file"
        disabled={busy}
        accept="image/png,image/jpeg,image/webp"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            const form = new FormData();
            form.set("file", file);
            if (userId) form.set("userId", userId);
            if (chatId) form.set("chatId", chatId);
            const r = await fetch("/api/avatar", {
              method: "POST",
              body: form,
            });
            if (!r.ok) throw new Error((await r.json()).error);
            await done();
          } catch (e) {
            notify(e);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Field>
  );
}
export function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="panel-heading">
          <strong>{title}</strong>
          <button className="icon-button" onClick={close} aria-label="Закрыть">
            ×
          </button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}
