import { normalizeEmail, stickerSuggestionQuery, type Sticker, type RecordingKind } from "@beacon/shared";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type FormEvent,
  type ReactNode,
} from "react";
import { io, Socket } from "socket.io-client";
import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { v7 } from "uuid";
import { authClient, beginPasskeyAutofill } from "@/auth-client";
import { PhotoThumbnail } from "./photo-thumbnail";
import { RecordingDialog } from "./recording";
import { StickerAdmin, StickerPicker, StickerSuggestions } from "./stickers";
import { Icon } from "./icon";
import { renderMessage } from "./message-types";

import type { User, Chat, Message, Pending, Group } from "@beacon/shared";
import { api, ApiError, Avatar, Field, AvatarPicker, Dialog } from "./ui";
import { Profile, Security, NewChat, UserForm, MembershipForm } from "./forms";
import { PushSettings, ChatPushToggle, forgetPushDevice, pushWorker, syncPushDevice } from "./push-settings";
export function Beacon(): ReactNode {
  const [recordingKind, setRecordingKind] = useState<RecordingKind | null>(null);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const photoMessageId = useRef(v7());
  const photoInput = useRef<HTMLInputElement>(null);
  const [upcomingService, setUpcomingService] = useState<string | null>(null);
  const stopPasskeyAutofill = useRef<(() => void) | null>(null);
  const navigate = useNavigate();
  const pathname = useLocation({ select: location => location.pathname });
  const legacyChat = useSearch({ strict: false }).chat;
  const section = pathname === "/profile" ? "profile" : pathname === "/admin" || pathname.startsWith("/admin/") ? "admin" : "chats";
  const adminSections = [
    { path: "/admin/users", title: "Пользователи", icon: "profile" },
    { path: "/admin/stickers", title: "Стикеры", icon: "sticker" },
    { path: "/admin/groups", title: "Группы пользователей", icon: "users" },
    { path: "/admin/chats", title: "Групповые чаты", icon: "chats" },
  ] as const;
  const adminPage = adminSections.find(item => item.path === pathname) ?? adminSections[0];
  const sectionRoutes = { chats: "/", admin: "/admin", profile: "/profile" } as const;
  const setSection = (value: keyof typeof sectionRoutes) => { void navigate({ to: sectionRoutes[value], search: {} }); };
  const closeChat = () => { setSelected(null); selectedRef.current = null; void navigate({ to: "/", search: {} }); };
  const [device, setDevice] = useState("desktop"),
    [me, setMe] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [step, setStep] = useState<"email" | "code">("email"),
    [busy, setBusy] = useState(false),
    [cooldown, setCooldown] = useState(0);
  const [chats, setChats] = useState<Chat[]>([]),
    [users, setUsers] = useState<User[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [hasMore, setHasMore] = useState(false),
    [historyBusy, setHistoryBusy] = useState(false);
  const [online, setOnline] = useState(true),
    [networkAvailable, setNetworkAvailable] = useState(true),
    [draft, setDraft] = useState(""),
    [context, setContext] = useState<{
      kind: "reply" | "edit";
      message: Message;
    } | null>(null),
    [pending, setPending] = useState<Pending[]>([]);
  const [modal, setModal] = useState<
      | "new"
      | "group"
      | "reaction"
      | "forward"
      | "user"
      | "membership"
      | null
    >(null),
    [target, setTarget] = useState<Message | null>(null),
    [editUser, setEditUser] = useState<User | null>(null),
    [groups, setGroups] = useState<Group[]>([]),
    [editGroup, setEditGroup] = useState<Group | null>(null),
    [managedChat, setManagedChat] = useState<string | null>(null),
    [details, setDetails] = useState<{ chat: any; members: User[] } | null>(
      null,
    ),
    [allGroups, setAllGroups] = useState<any[]>([]);
  const selectedRef = useRef(selected),
    meRef = useRef(me),
    drafts = useRef<Record<string, string>>({}),
    feed = useRef<HTMLDivElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null),
    socket = useRef<Socket | null>(null),
    sending = useRef(new Set<string>()),
    messagesRef = useRef(messages);
  selectedRef.current = selected;
  meRef.current = me;
  messagesRef.current = messages;
  const notify = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  useEffect(() => {
    if (!me?.id) return;
    const key = `update-drafts:${me.id}`;
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        drafts.current = Object.fromEntries(Object.entries(saved).filter(([id, text]) => /^[0-9a-f-]{36}$/i.test(id) && typeof text === "string"));
        if (selectedRef.current) setDraft(drafts.current[selectedRef.current] ?? "");
        sessionStorage.removeItem(key);
      }
    } catch { /* Invalid or unavailable browser storage must not prevent login. */ }
  }, [me?.id]);
  useEffect(() => {
    if (!me?.id) return;
    const save = (event: Event) => {
      if (busy || context?.kind === "edit") { event.preventDefault(); return; }
      const saved = { ...drafts.current };
      if (selected) saved[selected] = draft;
      try { sessionStorage.setItem(`update-drafts:${me.id}`, JSON.stringify(saved)); }
      catch { if (Object.values(saved).some(text => text.length)) event.preventDefault(); }
    };
    window.addEventListener("beacon:before-update", save);
    return () => window.removeEventListener("beacon:before-update", save);
  }, [me?.id, selected, draft, context, busy]);
  const refreshMe = useCallback(async () => {
    try {
      setMe(await api<User>("me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else notify(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (loading || me || step !== "email" || busy) return;
    const stop = beginPasskeyAutofill(refreshMe);
    stopPasskeyAutofill.current = stop;
    return () => {
      stop();
      if (stopPasskeyAutofill.current === stop) stopPasskeyAutofill.current = null;
    };
  }, [loading, me, step, busy, refreshMe]);
  const refreshLists = useCallback(async () => {
    const [cs, us] = await Promise.all([
      api<Chat[]>("chats"),
      api<User[]>("users"),
    ]);
    setChats(cs);
    setUsers(us);
  }, []);
  const refreshHistory = useCallback(async (id: string, older = false) => {
    if (older) setHistoryBusy(true);
    try {
      const first = messagesRef.current[0];
      const forward = !!first && !older;
      let cursor = first,
        more = true,
        inclusive = true;
      let result: { messages: Message[]; hasMore: boolean } = {
        messages: [],
        hasMore: false,
      };
      const collected: Message[] = [];
      do {
        const query = cursor
          ? `?${forward ? "after" : "before"}Id=${cursor.id}&${forward ? "after" : "before"}At=${encodeURIComponent(cursor.createdAt)}${forward && inclusive ? "&inclusive=true" : ""}`
          : "";
        result = await api<{ messages: Message[]; hasMore: boolean }>(
          `chats/${id}/messages${query}`,
        );
        if (selectedRef.current !== id) return;
        collected.push(...result.messages);
        more = forward && result.hasMore;
        cursor = result.messages.at(-1)!;
        inclusive = false;
      } while (more && cursor);
      result.messages = collected;
      if (!forward) setHasMore(result.hasMore);
      const nearBottom = feed.current
        ? feed.current.scrollHeight -
            feed.current.scrollTop -
            feed.current.clientHeight <
          160
        : true;
      setMessages((previous) => {
        const map = new Map(
          (older ? previous : previous.filter((m) => m.chatId === id)).map(
            (m) => [m.id, m],
          ),
        );
        result.messages.forEach((m) => map.set(m.id, m));
        return [...map.values()].sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        );
      });
      if (result.messages.length && !older && !document.hidden) {
        await api(`chats/${id}/read`, "POST", {
          messageId: result.messages.at(-1)!.id,
        });
        setChats((cs) =>
          cs.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
        );
      }
      if (!older && nearBottom)
        setTimeout(
          () => feed.current?.scrollTo({ top: feed.current.scrollHeight }),
          50,
        );
    } finally {
      if (older) setHistoryBusy(false);
    }
  }, []);
  const openChat = (id: string) => {
    if (selectedRef.current) drafts.current[selectedRef.current] = draft;
    setSelected(id);
    selectedRef.current = id;
    setMessages([]);
    messagesRef.current = [];
    setDraft(drafts.current[id] ?? "");
    setContext(null);
    setModal(null);
    setHasMore(false);
    if (pathname !== `/chats/${id}` || legacyChat) void navigate({
      to: "/chats/$chatId", params: { chatId: id }, search: {}, replace: !!legacyChat,
    });
  };
  const openChatRef=useRef(openChat);
  openChatRef.current=openChat;
  useEffect(()=>{
    if (!me?.firstName || !me.lastName) return;
    let live=true;
    const open=async(id:unknown)=>{
      if (typeof id!=="string" || !/^[0-9a-f-]{36}$/i.test(id)) return;
      try {
        const list=await api<Chat[]>("chats");
        if (!live) return;
        if (!list.some(c=>c.id===id)) throw new Error("У вас больше нет доступа к этой переписке");
        setChats(list);openChatRef.current(id);
      }catch(e){notify(e)}
    };
    const listener=(event:MessageEvent)=>{
      if(event.data?.type==="beacon:open-chat")void open(event.data.chatId);
    };
    navigator.serviceWorker?.addEventListener("message",listener);
    const routeChat = pathname.startsWith("/chats/") ? pathname.slice("/chats/".length) : legacyChat;
    if (routeChat && routeChat !== selectedRef.current) void open(routeChat);
    else if (pathname === "/" && !routeChat) { setSelected(null); selectedRef.current = null; }
    void syncPushDevice().catch(()=>{});
    return()=>{live=false;navigator.serviceWorker?.removeEventListener("message",listener)};
  },[me?.id,me?.firstName,me?.lastName,pathname,legacyChat]);
  useEffect(() => {
    const media = matchMedia("(max-width:780px)");
    const change = () => setDevice(media.matches ? "mobile" : "desktop");
    change();
    const networkChanged = () => setNetworkAvailable(navigator.onLine);
    networkChanged();
    window.addEventListener("online", networkChanged);
    window.addEventListener("offline", networkChanged);
    media.addEventListener("change", change);
    void refreshMe();
    const unauthorized = () => {
      setMe(null);
      setChats([]);
      setMessages([]);
      setPending([]);
      socket.current?.disconnect();
    };
    window.addEventListener("beacon:unauthorized", unauthorized);
    if ("serviceWorker" in navigator)
      void pushWorker().catch(() => {});
    return () => {
      media.removeEventListener("change", change);
      window.removeEventListener("online", networkChanged);
      window.removeEventListener("offline", networkChanged);
      window.removeEventListener("beacon:unauthorized", unauthorized);
    };
  }, [refreshMe]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(""), 7000);
    return () => clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  useEffect(() => {
    if (!me?.firstName || !me.lastName) return;
    void refreshLists().catch(notify);
    const s = io(import.meta.env.VITE_SOCKET_URL || undefined, {
      withCredentials: true,
    });
    socket.current = s;
    const sync = () => {
      void refreshLists().catch(notify);
      if (selectedRef.current)
        void refreshHistory(selectedRef.current).catch(notify);
    };
    s.on("connect", () => {
      setOnline(true);
      sync();
    });
    s.on("disconnect", (reason) => {
      setOnline(false);
      if (reason === "io server disconnect") void refreshMe();
    });
    s.on("connect_error", () => {
      setOnline(false);
      void refreshMe();
    });
    s.on("sync", sync);
    s.on("profile.changed", ({ userId }: { userId: string }) => {
      void refreshLists().catch(notify);
      if (userId === meRef.current?.id) void refreshMe();
    });
    s.on("chat.changed", ({ chatId }: { chatId: string }) => {
      void refreshLists().catch(notify);
      if (selectedRef.current === chatId)
        void refreshHistory(chatId).catch((e) => {
          if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
            setMessages([]);
            closeChat();
            selectedRef.current = null;
          }
          notify(e);
        });
    });
    const visible = () => {
      if (!document.hidden) sync();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      s.disconnect();
      document.removeEventListener("visibilitychange", visible);
    };
    // Callbacks read selected chat through refs; connection lives for the authenticated user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, me?.firstName, me?.lastName]);
  useEffect(() => {
    if (selected) void refreshHistory(selected).catch(notify);
  }, [selected]);
  useEffect(() => {
    const input = textarea.current;
    if (!input) return;
    input.style.height = "auto";
    const style = getComputedStyle(input),
      lh = parseFloat(style.lineHeight) || 20,
      pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    input.style.height =
      Math.max(
        lh * (device === "mobile" ? 1 : 2) + pad,
        Math.min(input.scrollHeight, lh * (device === "mobile" ? 8 : 13) + pad),
      ) + "px";
    input.style.overflowY =
      input.scrollHeight > parseFloat(input.style.height) ? "auto" : "hidden";
  }, [draft, device, context]);
  useEffect(() => {
    if (!me) return;
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(`pending:${me.id}`) ?? "[]",
      );
      if (Array.isArray(saved)) setPending(saved);
    } catch {}
  }, [me?.id]);
  useEffect(() => {
    if (me) sessionStorage.setItem(`pending:${me.id}`, JSON.stringify(pending));
  }, [pending, me?.id]);
  async function deliver(item: Pending) {
    if (sending.current.has(item.clientMessageId)) return;
    sending.current.add(item.clientMessageId);
    try {
      await api(`chats/${item.chatId}/messages`, "POST", item);
      setPending((ps) =>
        ps.filter((p) => p.clientMessageId !== item.clientMessageId),
      );
      await refreshLists();
      if (selectedRef.current === item.chatId)
        await refreshHistory(item.chatId);
    } catch (e) {
      setPending((ps) =>
        ps.map((p) =>
          p.clientMessageId === item.clientMessageId
            ? { ...p, failed: navigator.onLine }
            : p,
        ),
      );
      notify(e);
    } finally {
      sending.current.delete(item.clientMessageId);
    }
  }
  useEffect(() => {
    if (networkAvailable)
      pending.filter((p) => !p.failed).forEach((p) => void deliver(p));
  }, [pending, networkAvailable]);
  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    stopPasskeyAutofill.current?.();
    setBusy(true);
    setError("");
    try {
      const r = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      });
      if (r.error)
        throw new Error("Не удалось отправить код. Попробуйте позже.");
      setStep("code");
      setCode("");
      setCooldown(60);
    } catch (e) {
      notify(e);
    } finally {
      setBusy(false);
    }
  }
  async function verify(value: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await authClient.signIn.emailOtp({ email, otp: value });
      if (r.error) throw new Error("Код неверен или срок действия истёк");
      await refreshMe();
    } catch (e) {
      notify(e);
      setCode("");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { setPhotos([]); setRecordingKind(null); }, [selected]);
  async function submitMessage(e: FormEvent) {
    e.preventDefault();
    if (!selected || (!draft.trim() && !photos.length) || busy) return;
    if (photos.length && context?.kind !== "edit") {
      const chatId = selected;
      setBusy(true);
      try {
        const form = new FormData();
        photos.forEach(photo => form.append("file", photo)); form.set("chatId", chatId);
        form.set("clientMessageId", photoMessageId.current); form.set("text", draft);
        if (context?.message.id) form.set("replyToId", context.message.id);
        const response = await fetch("/api/photos", { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
        if (response.status === 401) window.dispatchEvent(new Event("beacon:unauthorized"));
        if (!response.ok) throw new Error((await response.json()).error || "Не удалось отправить фото");
        drafts.current[chatId] = "";
        if (selectedRef.current === chatId) { setPhotos([]); setDraft(""); setContext(null); }
        await refreshHistory(chatId); await refreshLists();
      } catch (e) { notify(e); } finally { setBusy(false); }
      return;
    }
    if (context?.kind === "edit") {
      setBusy(true);
      try {
        await api(`messages/${context.message.id}`, "PATCH", { text: draft });
        setContext(null);
        setDraft(drafts.current[selected] ?? "");
        await refreshHistory(selected);
      } catch (e) {
        notify(e);
      } finally {
        setBusy(false);
      }
      return;
    }
    const p = {
      chatId: selected,
      clientMessageId: v7(),
      text: draft,
      replyToId: context?.message.id,
    };
    setPending((ps) => [...ps, p]);
    setDraft("");
    drafts.current[selected] = "";
    setContext(null);
  }
  function queueSticker(sticker: Sticker, removeTrigger = false) {
    if (!selected || busy || context?.kind === "edit") return;
    setPending(items => [...items, { chatId: selected, clientMessageId: v7(), text: `Стикер: ${sticker.label}`, stickerId: sticker.id, replyToId: context?.kind === "reply" ? context.message.id : undefined }]);
    if (removeTrigger) {
      const query = stickerSuggestionQuery(draft);
      const next = query ? draft.trimEnd().slice(0, -query.length) : draft;
      setDraft(next); drafts.current[selected] = next;
    }
    setContext(null);
  }
  async function reaction(emoji: string) {
    if (!target) return;
    try {
      await api(`messages/${target.id}/reaction`, "PATCH", {
        emoji,
        remove: target.reactions.some(
          (r) => r.userId === me!.id && r.emoji === emoji,
        ),
      });
      setModal(null);
      if (selected) await refreshHistory(selected);
    } catch (e) {
      notify(e);
    }
  }
  async function loadManagement(id: string) {
    try {
      setManagedChat(id);
      setDetails(await api(`chats/${id}/members`));
      setModal("group");
    } catch (e) {
      notify(e);
    }
  }
  async function manage(input: unknown) {
    if (!managedChat) return;
    try {
      await api(`chats/${managedChat}`, "PATCH", input);
      await refreshLists();
      const d = await api<{ chat: any; members: User[] }>(
        `chats/${managedChat}/members`,
      );
      setDetails(d);
    } catch (e) {
      notify(e);
    }
  }
  async function jump(message: Message) {
    if (!message.replyToId) return;
    const found = document.getElementById(`message-${message.replyToId}`);
    if (found) {
      found.scrollIntoView({ block: "center", behavior: "smooth" });
      found.classList.add("highlight");
      setTimeout(() => found.classList.remove("highlight"), 1500);
    } else {
      try {
        let oldest = messagesRef.current[0];
        for (let n = 0; n < 100 && oldest; n++) {
          const result = await api<{ messages: Message[]; hasMore: boolean }>(
            `chats/${selected}/messages?beforeId=${oldest.id}&beforeAt=${encodeURIComponent(oldest.createdAt)}`,
          );
          setMessages((ms) => [...result.messages, ...ms]);
          if (result.messages.some((m) => m.id === message.replyToId)) {
            setTimeout(
              () =>
                document
                  .getElementById(`message-${message.replyToId}`)
                  ?.scrollIntoView({ block: "center" }),
              50,
            );
            return;
          }
          if (!result.hasMore) break;
          oldest = result.messages[0];
        }
        notify(
          "Сообщение находится глубже в истории. Загрузите предыдущие сообщения.",
        );
      } catch (e) {
        notify(e);
      }
    }
  }
  if (loading)
    return (
      <main className="startup-screen" role="status" aria-live="polite">
        <span className="startup-spinner" aria-hidden="true" />
        <h1>Beacon</h1>
        <p>Проверяем вход…</p>
      </main>
    );
  const toast = error && (
    <div className="notice error toast" role="alert">
      {error}
      <button
        className="text-button"
        onClick={() => setError("")}
        aria-label="Закрыть уведомление"
      >
        ×
      </button>
    </div>
  );
  if (!me)
    return (
      <div className="app" data-device={device}>
        {toast}
        <main className="auth-shell">
          <section className="auth-card minimal">
            {step === "email" ? (
              <>
                <form className="minimal-auth-form" onSubmit={requestCode}>
                  <div
                    className={`minimal-field ${busy ? "processing" : ""} ${error ? "invalid" : ""}`}
                  >
                    <label className="sr-only" htmlFor="email">
                      Email для входа
                    </label>
                    <input
                      id="email"
                      className="email-input"
                      type="email"
                      autoComplete="username webauthn"
                      required
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(normalizeEmail(e.target.value))}
                      disabled={busy}
                    />
                    <button
                      type="submit"
                      className="email-field-action email-submit-action"
                      aria-label="Получить код"
                      title="Получить код на email"
                      disabled={busy || !email.trim()}
                    >
                      <Icon name="next" />
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div className="code-surface">
                  <form
                    className="minimal-auth-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (code.length === 6) void verify(code);
                    }}
                  >
                    <div
                      className={`code-entry ${busy ? "processing" : ""} ${error ? "invalid" : ""}`}
                    >
                      {Array.from({ length: 6 }, (_, i) => (
                        <span
                          key={i}
                          className={`code-position ${code[i] ? "filled" : i === code.length ? "active" : ""}`}
                          aria-hidden="true"
                        >
                          {code[i]}
                        </span>
                      ))}
                      <input
                        className="code-input"
                        autoFocus
                        aria-label="Одноразовый код из шести цифр"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={code}
                        disabled={busy}
                        onChange={(e) => {
                          const v = e.target.value
                            .replace(/\D/g, "")
                            .slice(0, 6);
                          setCode(v);
                          if (v.length === 6) void verify(v);
                        }}
                      />
                    </div>
                    <button className="sr-only">Проверить код</button>
                  </form>
                  <div className="code-navigation">
                    <button
                      className="code-back"
                      aria-label="Вернуться к вводу email"
                      onClick={() => {
                        setStep("email");
                        setCode("");
                        setError("");
                      }}
                    >
                      <Icon name="back" />
                    </button>
                  </div>
                </div>
                <div className="auth-extra">
                  <button
                    className="text-button"
                    disabled={busy || cooldown > 0}
                    onClick={() => void requestCode()}
                  >
                    {cooldown
                      ? `Повторить через ${cooldown} с`
                      : "Отправить код повторно"}
                  </button>
                </div>
              </>
            )}
          </section>
        </main>
      </div>
    );
  if (!me.firstName || !me.lastName)
    return (
      <div className="app" data-device={device}>
        {toast}
        <main className="auth-shell">
          <section className="auth-card">
            <h1>Ваш профиль</h1>
            <Profile me={me} refresh={refreshMe} notify={notify} onboarding />
          </section>
        </main>
      </div>
    );
  const current = chats.find((c) => c.id === selected);
  const listedChats = chats.filter(c => c.kind === "group" || c.lastAt);
  const emptyDirectChats = new Map(chats.filter(c => c.kind === "direct" && !c.lastAt).map(c => [c.peerId, c]));
  const directUserIds = new Set(listedChats.filter(c => c.kind === "direct").map(c => c.peerId));
  const availableUsers = users.filter(u => u.id !== me.id && !directUserIds.has(u.id));
  const startDirectChat = async (userId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const chat = await api<{ id: string }>("chats", "POST", { kind: "direct", userIds: [userId] });
      await refreshLists();
      openChat(chat.id);
    } catch (e) { notify(e); }
    finally { setBusy(false); }
  };
  const nav = (
    <aside className="nav-rail" aria-label="Основная навигация">
      <button
        type="button"
        className="rail-action"
        aria-label="Главная"
        aria-haspopup="dialog"
        onClick={() => setUpcomingService("Главная")}
      >
        <Icon name="home" />
        <span className="rail-tooltip" aria-hidden="true">Главная</span>
      </button>
      <button
        className={`rail-action ${section === "chats" ? "active" : ""}`}
        onClick={() => setSection("chats")}
        aria-label="Чаты"
      >
        <Icon name="chats" />
        <span className="rail-tooltip" aria-hidden="true">Чаты</span>
      </button>
      {([
        ["search", "Поиск"],
        ["materials", "Материалы"],
        ["navigator", "Навигатор"],
        ["storage", "Хранилище"],
      ] as const).map(([icon, label]) => (
        <button
          key={icon}
          className="rail-action"
          aria-label={label}
          aria-haspopup="dialog"
          onClick={() => setUpcomingService(label)}
        >
          <Icon name={icon} />
          <span className="rail-tooltip" aria-hidden="true">{label}</span>
        </button>
      ))}
      {me.role === "admin" && (
        <button
          className={`rail-action ${section === "admin" ? "active" : ""}`}
          onClick={() => setSection("admin")}
          aria-label="Администрирование"
        >
          <Icon name="settings" />
          <span className="rail-tooltip" aria-hidden="true">Администрирование</span>
        </button>
      )}
      <span className="rail-spacer" />
      <button
        className={`rail-action ${section === "profile" ? "active" : ""}`}
        onClick={() => setSection("profile")}
        aria-label="Профиль"
      >
        {me.image ? <Avatar name={me.name} image={me.image} extra="rail-profile-avatar" /> : <Icon name="profile" />}
        <span className="rail-tooltip" aria-hidden="true">Профиль</span>
      </button>
    </aside>
  );
  function chooseContext(kind: "reply" | "edit", m: Message) {
    if (kind === "edit") {
      if (selected) drafts.current[selected] = draft;
      setDraft(m.content.text);
    }
    setContext({ kind, message: m });
    textarea.current?.focus();
  }
  function cancelContext() {
    if (context?.kind === "edit") setDraft(drafts.current[selected!] ?? "");
    setContext(null);
  }
  return (
    <div className="app" data-device={device}>
      {toast}
      {section === "chats" ? (
        <div className={`chat-shell ${selected ? "has-chat" : ""}`}>
          {nav}
          <section className="chat-list">
            <header className="list-header">
              <div className="list-presence">
                <div>
                  <strong>{me.name}</strong>
                  <span>
                    {online ? "Подключено" : "Связь восстанавливается"}
                  </span>
                </div>
                <button
                  className="profile-avatar-button"
                  onClick={() => setSection("profile")}
                  aria-label="Открыть профиль"
                >
                  <Avatar name={me.name} image={me.image} extra="self-avatar warm" />
                </button>
              </div>
              <div className="list-heading">
                <h1>Чаты</h1>
                <div className="inline-actions">
                  <button
                    className="icon-button"
                    onClick={() => setModal("new")}
                    aria-label="Создать чат"
                  >
                    <Icon name="plus" />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => void refreshLists().catch(notify)}
                    aria-label="Обновить список"
                  >
                    <Icon name="refresh" />
                  </button>
                </div>
              </div>
            </header>
            <div className="chat-rows">
              {listedChats.map((c) => (
                <button
                  className={`chat-row ${selected === c.id ? "active" : ""}`}
                  key={c.id}
                  onClick={() => openChat(c.id)}
                >
                  <Avatar
                    name={c.name ?? "Чат"}
                    image={c.avatar}
                    extra={c.kind === "group" ? "warm" : ""}
                  />
                  <div className="chat-row-main">
                    <div className="chat-row-title">{c.name}</div>
                    <div className="chat-row-preview">
                      {c.preview ?? "Сообщений пока нет"}
                    </div>
                  </div>
                  <div className="chat-row-side">
                    <span>
                      {c.lastAt
                        ? new Date(c.lastAt).toLocaleTimeString("ru", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                    {c.unread > 0 && <span className="unread">{c.unread}</span>}
                  </div>
                </button>
              ))}
              {availableUsers.map(u => (
                <button
                  className={`chat-row ${selected === emptyDirectChats.get(u.id)?.id ? "active" : ""}`}
                  key={`user:${u.id}`}
                  disabled={(!emptyDirectChats.has(u.id) && u.banned) || busy}
                  onClick={() => {
                    const existing = emptyDirectChats.get(u.id);
                    if (existing) openChat(existing.id);
                    else void startDirectChat(u.id);
                  }}
                >
                  <Avatar name={u.name} image={u.image} />
                  <div className="chat-row-main">
                    <div className="chat-row-title">{u.name}</div>
                    <div className="chat-row-preview">
                      {u.banned ? "Доступ приостановлен" : "Сообщений пока нет"}
                    </div>
                  </div>
                </button>
              ))}
              {!chats.length && !availableUsers.length && (
                <div className="empty-state">
                  <div>
                    <h2>Пока нет переписок</h2>
                    <p>Выберите участника или создайте групповой чат.</p>
                    <button
                      className="primary-button"
                      onClick={() => setModal("new")}
                    >
                      Начать общение
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
          <section className="workspace">
            {selected && current ? (
              <>
                <header className="chat-header">
                  <button
                    className="back-button"
                    aria-label="Назад к списку"
                    onClick={() => {
                      drafts.current[selected] = draft;
                      closeChat();
                    }}
                  >
                    <Icon name="back" />
                  </button>
                  <Avatar
                    name={current.name ?? "Чат"}
                    image={current.avatar}
                    extra="warm"
                  />
                  <div className="chat-header-copy">
                    <div className="chat-header-title">{current.name}</div>
                    <div className="chat-header-subtitle">
                      {current.kind === "group"
                        ? "Групповой чат"
                        : "Личная переписка"}
                    </div>
                  </div>
                  <ChatPushToggle chatId={selected} notify={notify}/>
                  {current.kind === "group" && (
                    <button
                      className="icon-button"
                      onClick={() => void loadManagement(selected)}
                      aria-label="Участники и настройки чата"
                    >
                      <Icon name="menu" />
                    </button>
                  )}
                </header>
                {!online && (
                  <div className="connection-strip">
                    Нет связи · отправка повторится после подключения
                  </div>
                )}
                <div className="feed" ref={feed}>
                  <div className="feed-inner">
                    {hasMore && (
                      <button
                        className="text-button"
                        disabled={historyBusy}
                        onClick={() =>
                          void refreshHistory(selected, true).catch(notify)
                        }
                      >
                        {historyBusy ? "Загружаем…" : "Предыдущие сообщения"}
                      </button>
                    )}
                    {messages.map((m, i) => (
                      <div key={m.id} id={`message-${m.id}`}>
                        <>
                          {(i === 0 ||
                            new Date(
                              messages[i - 1].createdAt,
                            ).toDateString() !==
                              new Date(m.createdAt).toDateString()) && (
                            <div className="date-divider">
                              <span>
                                {new Date(m.createdAt).toLocaleDateString("ru")}
                              </span>
                            </div>
                          )}
                        </>
                        <div
                          className={`message-group ${m.authorId === me.id ? "outgoing" : ""}`}
                        >
                          {m.authorId !== me.id && (
                            <div className="message-avatar">
                              <Avatar
                                name={m.authorName}
                                image={users.find(u => u.id === m.authorId)?.image ?? m.authorImage}
                                extra="green"
                              />
                            </div>
                          )}
                          <div className="group-body">
                            {m.authorId !== me.id && (
                              <div className="author">{m.authorName}</div>
                            )}
                            <div className="bubble-row">
                              <div className={`bubble ${m.type === "sticker" ? "sticker-bubble" : ""}`}>
                                {m.forwardedFrom && (
                                  <div className="forwarded">
                                    Переслано · {m.forwardedFrom.authorName}
                                  </div>
                                )}
                                {m.reply && (
                                  <button
                                    className="message-quote"
                                    onClick={() => void jump(m)}
                                  >
                                    {m.reply.authorName}: {m.reply.text}
                                  </button>
                                )}
                                <span className="bubble-text">
                                  {renderMessage(m.type, m.content)}
                                </span>
                                <span className="message-meta">
                                  {m.editedAt && (
                                    <span
                                      title={new Date(
                                        m.editedAt,
                                      ).toLocaleString("ru")}
                                    >
                                      Изменено ·{" "}
                                    </span>
                                  )}
                                  {new Date(m.createdAt).toLocaleTimeString(
                                    "ru",
                                    { hour: "2-digit", minute: "2-digit" },
                                  )}
                                </span>
                              </div>
                            </div>
                            <div className="message-tools">
                              {[
                                ...new Set(m.reactions.map((r) => r.emoji)),
                              ].map((emoji) => (
                                <button
                                  key={emoji}
                                  className={`reaction-pill ${m.reactions.some((r) => r.emoji === emoji && r.userId === me.id) ? "mine" : ""}`}
                                  title={m.reactions
                                    .filter((r) => r.emoji === emoji)
                                    .map((r) => r.name)
                                    .join(", ")}
                                  onClick={() => {
                                    setTarget(m);
                                    setModal("reaction");
                                  }}
                                >
                                  {emoji}{" "}
                                  {
                                    m.reactions.filter((r) => r.emoji === emoji)
                                      .length
                                  }
                                </button>
                              ))}
                              <button
                                onClick={() => {
                                  setTarget(m);
                                  setModal("reaction");
                                }}
                                aria-label="Поставить реакцию"
                              >
                                <Icon name="heart" />
                              </button>
                              <button onClick={() => chooseContext("reply", m)}>
                                Ответить
                              </button>
                              <button
                                onClick={() => {
                                  setTarget(m);
                                  setModal("forward");
                                }}
                              >
                                Переслать
                              </button>
                              {m.authorId === me.id && ["text", "photo"].includes(m.type) && (
                                <button
                                  onClick={() => chooseContext("edit", m)}
                                >
                                  Изменить
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {pending
                      .filter(
                        (p) =>
                          p.chatId === selected &&
                          !messages.some(
                            (m) => m.clientMessageId === p.clientMessageId,
                          ),
                      )
                      .map((p) => (
                        <div
                          className="message-group outgoing"
                          key={p.clientMessageId}
                        >
                          <div className="group-body">
                            <div className="bubble-row">
                              <div className="bubble">
                                <span className="bubble-text">{p.text}</span>
                              </div>
                            </div>
                            <div
                              className={`message-status ${p.failed ? "error" : "queue"}`}
                            >
                              {p.failed
                                ? "Не отправлено"
                                : networkAvailable
                                  ? "Отправляется…"
                                  : "В очереди"}
                              {p.failed && (
                                <button
                                  onClick={() => {
                                    setPending((ps) =>
                                      ps.map((x) =>
                                        x.clientMessageId === p.clientMessageId
                                          ? { ...x, failed: false }
                                          : x,
                                      ),
                                    );
                                    void deliver(p);
                                  }}
                                >
                                  Повторить
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
                <div
                  className="composer-dock"
                  data-composer-state={context?.kind ?? "input"}
                >
                  {context?.kind !== "edit" && !busy && !photos.length && <StickerSuggestions userId={me.id} text={stickerSuggestionQuery(draft)} choose={sticker => queueSticker(sticker, true)} />}
                  <form className="composer-open" onSubmit={submitMessage}>
                    {context && (
                      <div className="composer-context">
                        <div className="composer-context-title">
                          {context.kind === "edit"
                            ? "Редактирование сообщения"
                            : `Ответ · ${context.message.authorName}`}
                        </div>
                        <div className="composer-context-text">
                          {context.message.content.text || (context.message.type === "photo" ? "Фото" : "")}
                        </div>
                        <button
                          className="composer-context-close"
                          type="button"
                          onClick={cancelContext}
                          aria-label="Отменить контекст сообщения"
                        >
                          ×
                        </button>
                      </div>
                    )}
                    {!!photos.length && <div className="photo-previews">{photos.map((photo, index) => <div className="photo-preview" key={index}><PhotoThumbnail file={photo} index={index} /><button type="button" aria-label={`Убрать фото ${index + 1}`} disabled={busy} onClick={() => { photoMessageId.current = v7(); setPhotos(items => items.filter((_, i) => i !== index)); }}>Убрать</button></div>)}</div>}
                    <div className="composer-body">
                      <label className="sr-only" htmlFor="composer">
                        Сообщение
                      </label>
                      <textarea
                        ref={textarea}
                        disabled={busy && !!photos.length}
                        id="composer"
                        className="composer-input"
                        rows={device === "mobile" ? 1 : 2}
                        placeholder="Сообщение"
                        value={draft}
                        maxLength={10000}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            device === "desktop" &&
                            !e.nativeEvent.isComposing
                          ) {
                            e.preventDefault();
                            e.currentTarget.form?.requestSubmit();
                          }
                        }}
                      />
                    </div>
                    <div className="composer-actions live">
                      <button type="button" className="composer-action" aria-label="Записать голосовое сообщение" disabled={busy || context?.kind === "edit" || !!photos.length} onClick={() => setRecordingKind("audio")}><Icon name="mic" /></button>
                      <button type="button" className="composer-action" aria-label="Записать видеокружок" disabled={busy || context?.kind === "edit" || !!photos.length} onClick={() => setRecordingKind("circle")}><Icon name="video" /></button>
                      <button type="button" className="composer-action" aria-label="Выбрать стикер" disabled={busy || context?.kind === "edit"} onClick={() => setStickersOpen(true)}><Icon name="sticker" /></button>
                      <input ref={photoInput} type="file" multiple className="sr-only" aria-label="Выбрать фото" accept="image/jpeg,image/png,image/webp" disabled={busy || context?.kind === "edit"} onChange={e => {
                        const files = Array.from(e.target.files ?? []); e.target.value = "";
                        if (!files.length) return;
                        if (photos.length + files.length > 10) { notify(new Error("Можно отправить до 10 фотографий за раз")); return; }
                        if (files.some(file => !file.size || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) { notify(new Error("Выберите PNG, JPEG или WebP до 5 МБ каждый")); return; }
                        photoMessageId.current = v7(); setPhotos(items => [...items, ...files]);
                      }} />
                      <button type="button" className="composer-action" aria-label="Прикрепить фото" disabled={busy || context?.kind === "edit"} onClick={() => photoInput.current?.click()}><Icon name="photo" /></button>
                      <button
                        className="composer-action"
                        type="button"
                        aria-label="Добавить эмодзи"
                        onClick={() => {
                          setDraft((d) => d + "❤️");
                          textarea.current?.focus();
                        }}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="12" cy="12" r="8.5" />
                          <path d="M8.8 10h.1M15.1 10h.1M8.8 14c1.8 1.7 4.6 1.7 6.4 0" />
                        </svg>
                      </button>
                      <button
                        className="composer-action send-button"
                        disabled={(!draft.trim() && !photos.length) || busy}
                        aria-label={
                          context?.kind === "edit"
                            ? "Сохранить изменения"
                            : "Отправить сообщение"
                        }
                      >
                        <img
                          className="send-mark"
                          src="/assets/SERDTsA.png"
                          alt=""
                          draggable={false}
                        />
                      </button>
                    </div>
                  </form>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div>
                  <div className="empty-symbol">✦</div>
                  <h2>Выберите чат</h2>
                  <p>
                    Откройте личную или групповую переписку из списка слева.
                  </p>
                </div>
              </div>
            )}
          </section>
          <nav className="mobile-bottom" aria-label="Навигация">
            <button className="active">
              <Icon name="chats" />
              <span>Чаты</span>
            </button>
            {me.role === "admin" ? (
              <button onClick={() => setSection("admin")}>
                <Icon name="settings" />
                <span>Администрирование</span>
              </button>
            ) : (
              <span />
            )}
            <button onClick={() => setSection("profile")}>
              <Icon name="users" />
              <span>Профиль</span>
            </button>
          </nav>
        </div>
      ) : (
        <div className={`admin-shell ${section === "admin" && me.role === "admin" ? "administration-shell" : ""} ${pathname !== "/admin" ? "has-admin-page" : ""}`}>
          {nav}
          {section === "admin" && me.role === "admin" && <aside className="admin-sections">
            <header className="admin-sections-heading">
              <button type="button" className="icon-button admin-mobile-back" aria-label="Назад к чатам" onClick={() => setSection("chats")}><Icon name="back" /></button>
              <h1>Администрирование</h1>
            </header>
            <nav aria-label="Разделы администрирования">
              {adminSections.map(item => <button type="button" key={item.path}
                className={`admin-section-row ${adminPage.path === item.path ? "active" : ""}`}
                aria-current={adminPage.path === item.path ? "page" : undefined}
                onClick={() => void navigate({ to: item.path, search: {} })}>
                <Icon name={item.icon} /><span>{item.title}</span>
              </button>)}
            </nav>
          </aside>}
          <main className="settings">
            <header className="admin-header">
              <button type="button" className={`icon-button ${section === "admin" ? "admin-mobile-back" : ""}`}
                onClick={() => setSection(section === "admin" ? "admin" : "chats")}
                aria-label={section === "admin" ? "Назад к разделам" : "Назад к чатам"}><Icon name="back" /></button>
              <div className="admin-title"><h1>{section === "profile" ? "Профиль" : adminPage.title}</h1></div>
            </header>
            <div className="settings-main">
              {section === "profile" ? (
                <>
                  <Profile me={me} refresh={refreshMe} notify={notify} />
                  <Security email={me.email} notify={notify} />
                  <PushSettings notify={notify}/>
                  <button
                    className="secondary-button"
                    onClick={async () => {
                      await forgetPushDevice().catch(()=>{});
                      await authClient.signOut();
                      sessionStorage.removeItem(`pending:${me.id}`);
                      sessionStorage.removeItem(`update-drafts:${me.id}`);
                      setMe(null);
                      setSection("chats");
                      closeChat();
                      setMessages([]);
                      setPending([]);
                    }}
                  >
                    Выйти из аккаунта
                  </button>
                </>
              ) : me.role !== "admin" ? <p>Этот раздел доступен только администраторам.</p>
              : adminPage.path === "/admin/stickers" ? <StickerAdmin notify={notify} />
              : adminPage.path === "/admin/groups" ? (
                <div className="settings-card">
                  <div className="panel-heading">
                    <strong>Группы пользователей</strong>
                    <button
                      className="primary-button"
                      onClick={async () => {
                        try {
                          setGroups(await api("admin/groups"));
                          setEditGroup(null);
                          setModal("membership");
                        } catch (e) {
                          notify(e);
                        }
                      }}
                    >
                      Управление
                    </button>
                  </div>
                </div>
              ) : adminPage.path === "/admin/chats" ? (
                <div className="settings-card">
                  <h2>Все групповые чаты</h2>
                  <button
                    className="secondary-button"
                    onClick={async () => {
                      try {
                        setAllGroups(await api("admin/chats"));
                      } catch (e) {
                        notify(e);
                      }
                    }}
                  >
                    Показать список
                  </button>
                  {allGroups.map((c) => (
                    <button
                      key={c.id}
                      className="secondary-button"
                      onClick={() => void loadManagement(c.id)}
                    >
                      {c.title}
                    </button>
                  ))}
                  <p className="field-note">
                    Управление не открывает переписку. Читать её могут только
                    участники.
                  </p>
                </div>
              ) : (
                <div className="settings-card">
                  <div className="panel-heading">
                    <strong>Пользователи</strong>
                    <button
                      className="primary-button"
                      onClick={() => {
                        setEditUser(null);
                        setModal("user");
                      }}
                    >
                      Создать
                    </button>
                  </div>
                  {users.map((u) => (
                    <button
                      className="user-row editable"
                      key={u.id}
                      onClick={() => {
                        setEditUser(u);
                        setModal("user");
                      }}
                    >
                      <Avatar name={u.name} image={u.image} />
                      <div className="user-copy">
                        <div className="user-name">
                          {u.name || "Профиль не заполнен"}
                        </div>
                        <div className="user-email">{u.email}</div>
                      </div>
                      <span className="role-label">
                        {u.role === "admin"
                          ? "Администратор"
                          : "Пользователь"}
                      </span>
                      <span
                        className={`status-label ${!u.banned ? "active" : ""}`}
                      >
                        {u.banned ? "Заблокирован" : "Активен"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      )}
      {recordingKind && selected && <RecordingDialog key={`${selected}:${recordingKind}`} kind={recordingKind} chatId={selected} replyToId={context?.kind === "reply" ? context.message.id : undefined} notify={notify} close={() => setRecordingKind(null)} sent={async chatId => {
        if (selectedRef.current === chatId) { setContext(null); await refreshHistory(chatId); }
        await refreshLists();
      }} />}
      {stickersOpen && me && selected && <StickerPicker userId={me.id} notify={notify} close={() => setStickersOpen(false)} choose={sticker => queueSticker(sticker)} />}
      {upcomingService && (
        <Dialog title={upcomingService} close={() => setUpcomingService(null)}>
          <div className="empty-state"><h2>В разработке</h2></div>
        </Dialog>
      )}
      {modal === "new" && (
        <Dialog title="Новый чат" close={() => setModal(null)}>
          <NewChat
            users={users.filter((u) => !u.banned && u.id !== me.id)}
            done={async (id) => {
              openChat(id);
              await refreshLists();
            }}
            notify={notify}
          />
        </Dialog>
      )}
      {modal === "reaction" && target && (
        <Dialog title="Реакция на сообщение" close={() => setModal(null)}>
          <div className="emoji-picker">
            {["❤️", "👍", "👎", "😂", "😮", "😢", "🙏", "🔥"].map((e) => (
              <button key={e} onClick={() => void reaction(e)} aria-label={e}>
                {e}
              </button>
            ))}
          </div>
          {target.reactions.map((r) => (
            <div key={r.userId}>
              {r.emoji} {r.name}
            </div>
          ))}
          <p className="field-note">
            Одна реакция. Повторный выбор снимает её.
          </p>
        </Dialog>
      )}
      {modal === "forward" && target && (
        <Dialog title="Переслать сообщение" close={() => setModal(null)}>
          {chats.map((c) => (
            <button
              className="secondary-button"
              key={c.id}
              onClick={() => {
                const p = {
                  chatId: c.id,
                  clientMessageId: v7(),
                  text: target.content.text,
                  forwardId: target.id,
                };
                setPending((ps) => [...ps, p]);
                setModal(null);
              }}
            >
              {c.name}
            </button>
          ))}
        </Dialog>
      )}
      {modal === "group" && details && (
        <Dialog title="Участники и настройки" close={() => setModal(null)}>
          {(details.chat.owner_id === me.id || me.role === "admin") && (
            <>
              <form
                className="inline-actions"
                key={details.chat.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  void manage({
                    title: new FormData(e.currentTarget).get("title"),
                  });
                }}
              >
                <Field label="Название">
                  <input
                    name="title"
                    defaultValue={details.chat.title}
                    required
                    maxLength={120}
                  />
                </Field>
                <button className="primary-button">Сохранить</button>
              </form>
              <AvatarPicker
                chatId={details.chat.id}
                done={async () => {
                  await loadManagement(details.chat.id);
                  await refreshLists();
                }}
                notify={notify}
              />
              <Field label="Добавить участника">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) void manage({ add: e.target.value });
                    e.target.value = "";
                  }}
                >
                  <option value="">Выберите пользователя</option>
                  {users
                    .filter(
                      (u) =>
                        !u.banned &&
                        !details.members.some((m) => m.id === u.id),
                    )
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </Field>
            </>
          )}
          {details.members.map((u) => (
            <div className="inline-actions" key={u.id}>
              <Avatar name={u.name} image={u.image} />
              <span>
                {u.name}
                {details.chat.owner_id === u.id ? " · владелец" : ""}
              </span>
              {(details.chat.owner_id === me.id || me.role === "admin") &&
                u.id !== details.chat.owner_id && (
                  <>
                    <button
                      className="text-button"
                      onClick={() => void manage({ remove: u.id })}
                    >
                      Исключить
                    </button>
                    {!u.banned && (
                      <button
                        className="text-button"
                        onClick={() => void manage({ ownerId: u.id })}
                      >
                        Передать управление
                      </button>
                    )}
                  </>
                )}
            </div>
          ))}
          {details.members.some((u) => u.id === me.id) && (
            <button
              className="secondary-button"
              onClick={async () => {
                try {
                  await api(`chats/${managedChat}`, "PATCH", { leave: true });
                  setModal(null);
                  if (selected === managedChat) closeChat();
                  await refreshLists();
                } catch (e) {
                  notify(e);
                }
              }}
            >
              Выйти из группы
            </button>
          )}
        </Dialog>
      )}
      {modal === "user" && (
        <Dialog
          title={
            editUser ? "Редактирование пользователя" : "Новый пользователь"
          }
          close={() => setModal(null)}
        >
          <UserForm
            user={editUser}
            done={async () => {
              setModal(null);
              await refreshLists();
              await refreshMe();
            }}
            notify={notify}
          />
        </Dialog>
      )}
      {modal === "membership" && (
        <Dialog title="Группы пользователей" close={() => setModal(null)}>
          <div className="inline-actions">
            {groups.map((g) => (
              <button
                className="secondary-button"
                key={g.id}
                onClick={() => setEditGroup(g)}
              >
                {g.name}
              </button>
            ))}
            <button className="text-button" onClick={() => setEditGroup(null)}>
              Новая группа
            </button>
          </div>
          <MembershipForm
            key={editGroup?.id ?? "new"}
            group={editGroup}
            users={users}
            done={async () => {
              setGroups(await api("admin/groups"));
              setEditGroup(null);
            }}
            notify={notify}
          />
        </Dialog>
      )}
    </div>
  );
}
