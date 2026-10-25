"use client";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type FormEvent,
  type ReactNode,
} from "react";
import { io, Socket } from "socket.io-client";
import { v7 } from "uuid";
import { authClient } from "@/modules/auth/client";
import { Icon } from "./icon";
import { renderMessage } from "./message-types";

import type { User, Chat, Message, Pending, Group } from "./types";
import { api, ApiError, Avatar, Field, AvatarPicker, Dialog } from "./ui";
import { Profile, Security, NewChat, UserForm, MembershipForm } from "./forms";
import { PushSettings, ChatPushToggle, forgetPushDevice, pushWorker, syncPushDevice } from "./push-settings";
export function Beacon() {
  const [device, setDevice] = useState("desktop"),
    [me, setMe] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [step, setStep] = useState<"email" | "code">("email"),
    [busy, setBusy] = useState(false),
    [cooldown, setCooldown] = useState(0);
  const [section, setSection] = useState("chats"),
    [chats, setChats] = useState<Chat[]>([]),
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
      | "people"
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
  const refreshMe = useCallback(async () => {
    try {
      const s = await authClient.getSession();
      if (s.error) throw new Error("Не удалось проверить вход");
      if (!s.data) {
        setMe(null);
        return;
      }
      setMe(await api<User>("me"));
    } catch (e) {
      notify(e);
    } finally {
      setLoading(false);
    }
  }, []);
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
    setSection("chats");
    setModal(null);
    setHasMore(false);
    const url=new URL(window.location.href);
    url.searchParams.set("chat",id);
    window.history.replaceState(null,"",url);
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
    void open(new URL(window.location.href).searchParams.get("chat"));
    void syncPushDevice().catch(()=>{});
    return()=>{live=false;navigator.serviceWorker?.removeEventListener("message",listener)};
  },[me?.id,me?.firstName,me?.lastName]);
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
    const s = io(process.env.NEXT_PUBLIC_SOCKET_URL ?? undefined, {
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
    s.on("chat.changed", ({ chatId }: { chatId: string }) => {
      void refreshLists().catch(notify);
      if (selectedRef.current === chatId)
        void refreshHistory(chatId).catch((e) => {
          if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
            setMessages([]);
            setSelected(null);
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
  async function passkeyLogin() {
    setBusy(true);
    try {
      const r = await authClient.signIn.passkey();
      if (r.error) throw new Error("Не удалось войти с ключом доступа");
      await refreshMe();
    } catch (e) {
      notify(e);
    } finally {
      setBusy(false);
    }
  }
  async function submitMessage(e: FormEvent) {
    e.preventDefault();
    if (!selected || !draft.trim() || busy) return;
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
      <main className="loading-screen">
        <span className="spinner" aria-label="Загрузка" />
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
                      autoComplete="email"
                      required
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <button className="sr-only" disabled={busy}>
                    Получить код
                  </button>
                </form>
                <div className="auth-extra">
                  <button
                    className="text-button"
                    onClick={passkeyLogin}
                    disabled={busy}
                  >
                    Войти с ключом доступа
                  </button>
                </div>
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
  const nav = (
    <aside className="nav-rail" aria-label="Основная навигация">
      <div className="brand-mark">П</div>
      <button
        className={`rail-action ${section === "people" ? "active" : ""}`}
        onClick={() => setSection("people")}
      >
        <Icon name="users" />
        <small>Люди</small>
      </button>
      <button className="rail-action" onClick={() => setModal("new")}>
        <Icon name="plus" />
        <small>Создать</small>
      </button>
      <button
        className={`rail-action ${section === "chats" ? "active" : ""}`}
        onClick={() => setSection("chats")}
      >
        <Icon name="chats" />
        <small>Чаты</small>
      </button>
      {me.role === "admin" && (
        <button
          className={`rail-action ${section === "admin" ? "active" : ""}`}
          onClick={() => setSection("admin")}
        >
          <Icon name="settings" />
          <small>Управление</small>
        </button>
      )}
      <span className="rail-spacer" />
      <button
        className="rail-action"
        onClick={() => setSection("profile")}
        aria-label="Профиль"
      >
        {me.firstName[0]}
        {me.lastName[0]}
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
                  className="avatar self-avatar warm"
                  onClick={() => setSection("profile")}
                  aria-label="Открыть профиль"
                >
                  {me.firstName[0]}
                  {me.lastName[0]}
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
              {chats.map((c) => (
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
              {!chats.length && (
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
                      setSelected(null);
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
                                image={m.authorImage}
                                extra="green"
                              />
                            </div>
                          )}
                          <div className="group-body">
                            {m.authorId !== me.id && (
                              <div className="author">{m.authorName}</div>
                            )}
                            <div className="bubble-row">
                              <div className="bubble">
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
                                  {m.content.text}
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
                              {m.authorId === me.id && (
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
                  <form className="composer-open" onSubmit={submitMessage}>
                    {context && (
                      <div className="composer-context">
                        <div className="composer-context-title">
                          {context.kind === "edit"
                            ? "Редактирование сообщения"
                            : `Ответ · ${context.message.authorName}`}
                        </div>
                        <div className="composer-context-text">
                          {context.message.content.text}
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
                    <div className="composer-body">
                      <label className="sr-only" htmlFor="composer">
                        Сообщение
                      </label>
                      <textarea
                        ref={textarea}
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
                        disabled={!draft.trim() || busy}
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
            <button onClick={() => setSection("people")}>
              <Icon name="users" />
              <span>Люди</span>
            </button>
            <button onClick={() => setModal("new")}>
              <Icon name="plus" />
              <span>Создать</span>
            </button>
            <button className="active">
              <Icon name="chats" />
              <span>Чаты</span>
            </button>
            {me.role === "admin" ? (
              <button onClick={() => setSection("admin")}>
                <Icon name="settings" />
                <span>Управление</span>
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
        <div className="admin-shell">
          {nav}
          <main className="settings">
            <header className="admin-header">
              <button
                className="icon-button"
                onClick={() => setSection("chats")}
                aria-label="Назад к чатам"
              >
                <Icon name="back" />
              </button>
              <div className="admin-title">
                <h1>
                  {section === "profile"
                    ? "Профиль"
                    : section === "admin"
                      ? "Управление"
                      : "Участники"}
                </h1>
              </div>
            </header>
            <div className="settings-main">
              {section === "profile" ? (
                <>
                  <Profile me={me} refresh={refreshMe} notify={notify} />
                  <Security notify={notify} />
                  <PushSettings notify={notify}/>
                  <button
                    className="secondary-button"
                    onClick={async () => {
                      await forgetPushDevice().catch(()=>{});
                      await authClient.signOut();
                      sessionStorage.removeItem(`pending:${me.id}`);
                      setMe(null);
                      setSection("chats");
                      setSelected(null);
                      setMessages([]);
                      setPending([]);
                    }}
                  >
                    Выйти из аккаунта
                  </button>
                </>
              ) : section === "people" ? (
                <div className="settings-card">
                  {users.map((u) => (
                    <button
                      className="chat-row"
                      key={u.id}
                      disabled={u.banned || u.id === me.id}
                      onClick={async () => {
                        try {
                          openChat(
                            (
                              await api("chats", "POST", {
                                kind: "direct",
                                userIds: [u.id],
                              })
                            ).id,
                          );
                          await refreshLists();
                        } catch (e) {
                          notify(e);
                        }
                      }}
                    >
                      <Avatar name={u.name} image={u.image} />
                      <div className="chat-row-main">
                        <div className="chat-row-title">{u.name}</div>
                        <div className="chat-row-preview">
                          {u.banned
                            ? "Доступ приостановлен"
                            : u.id === me.id
                              ? "Это вы"
                              : "Написать сообщение"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <>
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
                </>
              )}
            </div>
          </main>
        </div>
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
                  if (selected === managedChat) setSelected(null);
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
