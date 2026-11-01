import { Button } from "./app-button";
import { ModalOverlay, Modal, Dialog as AriaDialog } from "react-aria-components";
import { cachedResponse, localAccount, localGeneration, acceptAccount, writeCache, reconcileChats, forgetAccount } from "../offline";
import type { User, Chat } from "@beacon/shared";
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
  networkOnly = false,
  extraHeaders?: Record<string,string>,
): Promise<T> {
  const owner=localAccount(), generation=localGeneration();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/v1/${path}`, {
      signal: controller.signal,
      method,
      headers: { ...extraHeaders, ...(data ? { "Content-Type": "application/json" } : {}) },
      body: data ? JSON.stringify(data) : undefined,
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) {
      if (response.status === 401 && generation===localGeneration()) {
        void forgetAccount();
        window.dispatchEvent(new Event("beacon:unauthorized"));
      }
      throw new ApiError(body.error ?? "Не удалось выполнить запрос", response.status);
    }
    if (generation!==localGeneration()) throw new DOMException("Account changed", "AbortError");
    if(method==="GET") {
      if(path==="me") await acceptAccount(body as User);
      else if(path==="chats") await reconcileChats(body as Chat[],owner);
      else if(path==="users") await writeCache(path,body,owner);
    }
    return body;
  } catch(error) {
    if(method==="GET"&&!networkOnly&&!(error instanceof ApiError)&&generation===localGeneration()) {
      const cached=await cachedResponse(path);
      if(cached!==undefined)return cached as T;
    }
    throw error;
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
export function Dialog({title,close,children,className=""}:{title:string;close:()=>void;children:ReactNode;className?:string}) {
  return <ModalOverlay isOpen isDismissable onOpenChange={open=>{if(!open)close();}} className={`dialog-backdrop ${className?`${className}-backdrop`:""}`}>
    <Modal className={`dialog ${className}`}><AriaDialog aria-label={title} className="app-dialog-content">
      <div className="panel-heading"><strong>{title}</strong><Button className="icon-button" onClick={close} aria-label="Закрыть">×</Button></div>
      <div className="dialog-body">{children}</div>
    </AriaDialog></Modal>
  </ModalOverlay>;
}

export function OverlayDialog({title,close,children,className,backdropClassName="dialog-backdrop"}:{title:string;close:()=>void;children:ReactNode;className:string;backdropClassName?:string}) {
 return <ModalOverlay isOpen isDismissable onOpenChange={open=>{if(!open)close();}} className={backdropClassName}><Modal className={className}><AriaDialog aria-label={title} className="app-dialog-content">{children}</AriaDialog></Modal></ModalOverlay>;
}
