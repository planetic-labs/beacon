import {Calls,startPersonalCall} from "./calls";
import { Phone, Video } from "lucide-react";
import {SelectableChatRow} from "./chat-list-selection";
import {ChatListActions,ChatSelectionBadge} from "./chat-list-actions";
import {useTouchSwipe} from "./touch-swipe";
import {useChatFolders,FolderTabs,FolderSettings} from "./chat-folders";
import {ActionMenu} from "./action-menu";
import { X, Reply, Forward, Copy, Trash2, MoreHorizontal, ChevronRight } from "lucide-react";
import { MobileInteractions } from "./interaction-context";
import { Form } from "react-aria-components";
import { ActionPanel } from "./action-panel";
import { Button } from "./app-button";
import { MessageActions } from "./message-actions";
import { Home } from "./home";
import { Materials } from "./materials";
import { Storage } from "./storage";
import { StorageAdmin } from "./storage-admin";
import { ComposerFrame, createComposerState } from "./composer-state";
import { DeviceData } from "./device-data";
import { useOfflineSync } from "./offline-sync";
import { restoreAccount, readCache, localAccount, localGeneration, forgetAccount, queued, enqueue, acknowledge, storageProblem } from "../offline";
import { About } from "./about";
import { EmojiMenu } from "./emoji-menu";
import { useDraftSync } from "./drafts";
import { PhotoViewer, type PhotoTarget } from "./photo-viewer";
import { ChatAttachments } from "./chat-attachments";
import { ReadDetails } from "./read-details";
import { usePresence, presenceText } from "./presence";
import { PinnedMessages } from "./pins";
import { AttachmentUpload } from "./attachment-upload";
import { attachmentLimits, type AttachmentKind } from "@beacon/shared";
import { SearchPanel } from "./search";
import { useChatFeatures, DeliveryStatus, MentionSuggestions } from "./chat-features";
import { moveMentions, type Mention, type SearchHit, normalizeEmail, stickerSuggestionQuery, type Sticker, type RecordingKind } from "@beacon/shared";
import {
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
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

import type { User, Chat, Message, Pending, Group, OfflineSnapshot } from "@beacon/shared";
import { api, ApiError, Avatar, Field, AvatarPicker, Dialog } from "./ui";
import { Profile, Security, NewChat, UserForm, MembershipForm } from "./forms";
import { PushSettings, ChatPushToggle, forgetPushDevice, pushWorker, syncPushDevice } from "./push-settings";
export function Beacon(): ReactNode {
  const appFrame=useRef<HTMLDivElement>(null);
  const observeComposerSize=useCallback((node:HTMLDivElement|null)=>{
    if(!node)return;
    const workspace=node.closest<HTMLElement>(".workspace");
    const observer=new ResizeObserver(()=>{
      const height=`${node.getBoundingClientRect().height}px`;
      if(workspace?.style.getPropertyValue("--composer-height")!==height)workspace?.style.setProperty("--composer-height",height);
    });
    observer.observe(node);return ()=>observer.disconnect();
  },[]);

  useEffect(()=>{
    const viewport=window.visualViewport;
    if(!viewport)return;
    let frame=0;
    const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      if(viewport.scale!==1)return;
      appFrame.current?.style.setProperty("--visible-height",`${viewport.height}px`);
      appFrame.current?.style.setProperty("--visible-top",`${viewport.offsetTop}px`);
    });};
    update();viewport.addEventListener("resize",update);viewport.addEventListener("scroll",update);
    return ()=>{cancelAnimationFrame(frame);viewport.removeEventListener("resize",update);viewport.removeEventListener("scroll",update);};
  },[]);
  const [photoView,setPhotoView]=useState<PhotoTarget|null>(null),[attachmentsOpen,setAttachmentsOpen]=useState(false),[readDetails,setReadDetails]=useState<Message|null>(null);
  const [selectionMode,setSelectionMode]=useState(false),[selectedMessages,setSelectedMessages]=useState<string[]>([]);
  const [forwardSources,setForwardSources]=useState<Message[]>([]),[pinsRevision,setPinsRevision]=useState(0);
  const [attachment,setAttachment]=useState<{file:File;kind:AttachmentKind;chatId:string}|null>(null);
  const [batchDeleting,setBatchDeleting]=useState<Message[]|null>(null);
  const [deleting,setDeleting]=useState<Message|null>(null),[deleteBusy,setDeleteBusy]=useState(false);
  const attachmentInput=useRef<HTMLInputElement>(null);
  const [searchRevision,setSearchRevision]=useState(0);
  const [searchOpen,setSearchOpen] = useState(false);
  const [searchScope,setSearchScope] = useState<{id:string;name:string}|undefined>(undefined);
  const [composerState] = useState(createComposerState);
  const setMentionCursor = composerState.cursor;
  const setDraftValue = composerState.text;
  const mentions = useRef<Mention[]>([]), draftValue = useRef("");
  const mentionDrafts = useRef<Record<string,Mention[]>>({});
  const [chatMembers,setChatMembers] = useState<User[]>([]);
  const [offlineWindow,setOfflineWindow]=useState<OfflineSnapshot|null>(null);
  const offlineWindowRef=useRef<OfflineSnapshot|null>(null);
  const [historical,setHistorical] = useState(false);
  const initialScroll = useRef<string|null>(null);
  const positionedUnread=useRef(false), interactedWithHistory=useRef(false);
  const historyVersion = useRef(0), aroundBusy = useRef(false);
  const historicalRef = useRef(false), jumpRequest = useRef<{chatId:string;messageId:string}|null>(null);
  const [recordingKind, setRecordingKind] = useState<RecordingKind | null>(null);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [emojiOpen,setEmojiOpen]=useState(false);
  const emojiSelection=useRef({start:0,end:0});
  const [photos, setPhotos] = useState<File[]>([]);
  const photoMessageId = useRef(v7());
  const photoInput = useRef<HTMLInputElement>(null);
  const [upcomingService, setUpcomingService] = useState<string | null>(null);
  const stopPasskeyAutofill = useRef<(() => void) | null>(null);
  const navigate = useNavigate();
  const pathname = useLocation({ select: location => location.pathname });
  const legacyChat = useSearch({ strict: false }).chat;
  const [device, setDevice] = useState("desktop"),
    [me, setMe] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const requestedSection = (pathname === "/settings" || pathname.startsWith("/settings/")) ? "profile" : pathname === "/admin" || pathname.startsWith("/admin/") ? "admin" : pathname === "/storage" ? "storage" : pathname === "/materials" ? "materials" : pathname === "/more" ? "more" : pathname === "/home" ? "home" : "chats";
  const section = me?.role !== "admin" && (requestedSection === "storage" || requestedSection === "materials") ? "chats" : requestedSection;
  useEffect(() => {
    if(me && me.role!=="admin" && (requestedSection==="storage"||requestedSection==="materials"))void navigate({to:"/",search:{},replace:true});
  },[me?.role,requestedSection,navigate]);
  const adminSections = [
    { path: "/admin/users", title: "Пользователи", icon: "profile" },
    { path: "/admin/stickers", title: "Стикеры", icon: "sticker" },
    { path: "/admin/groups", title: "Группы пользователей", icon: "users" },
    { path: "/admin/chats", title: "Групповые чаты", icon: "chats" },
    { path: "/admin/storage", title: "Хранилища", icon: "storage" },
  ] as const;
  const systemGroups = [
    {role:"admin",name:"Администраторы",description:"Управление пользователями, группами и остальными разделами администрирования."},
    {role:"user",name:"Пользователи",description:"Обычный доступ к чатам и сервисам без административных функций."},
  ] as const;
  const settingsSections = [
    {path:"/settings/profile",title:"Профиль",icon:"profile"},
    {path:"/settings/security",title:"Ключи доступа",icon:"key"},
    {path:"/settings/notifications",title:"Push-уведомления",icon:"bell"},
    {path:"/settings/stickers",title:"Стикеры",icon:"sticker"},
    {path:"/settings/folders",title:"Папки чатов",icon:"chats"},
    {path:"/settings/data",title:"Данные на устройстве",icon:"storage"},
    {path:"/settings/about",title:"О приложении",icon:"info"},
  ] as const;
  const settingsPage=settingsSections.find(item=>item.path===pathname)??settingsSections[0];
  const sectionItems=section==="profile"?settingsSections:adminSections;
  const activeSectionPage=section==="profile"?settingsPage:adminSections.find(item=>item.path===pathname)??adminSections[0];
  const sectionTitle=section==="profile"?"Настройки":"Администрирование";
  const adminPage = adminSections.find(item => item.path === pathname) ?? adminSections[0];
  const sectionRoutes = { chats: "/", admin: "/admin", profile: "/settings", storage: "/storage", materials: "/materials", more: "/more", home: "/home" } as const;
  const setSection = (value: keyof typeof sectionRoutes) => { draftSync.current.flush(); void navigate({ to: sectionRoutes[value], search: {} }); };
  const closeChat = () => { draftSync.current.flush(); setSelected(null); selectedRef.current = null; void navigate({ to: "/", search: {} }); };
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
  const [online, setOnline] = useState(false),
    [networkAvailable, setNetworkAvailable] = useState(true),
    [context, setContext] = useState<{
      kind: "reply" | "edit";
      message: Message;
    } | null>(null),
    [pending, setPending] = useState<Pending[]>([]);
  function setDraft(value: string | ((before:string)=>string), sync = true, explicitMentions?:Mention[]) {
    const next = typeof value === "function" ? value(draftValue.current) : value;
    mentions.current = explicitMentions??moveMentions(draftValue.current,next,mentions.current);
    draftValue.current=next;setDraftValue(next);
    if(sync && selectedRef.current && context?.kind!=="edit"){
      const id=selectedRef.current;
      drafts.current[id]=next;
      mentionDrafts.current[id]=mentions.current.slice();draftSync.current.change(id,{text:next,mentions:mentionDrafts.current[id]});
    }
  }
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
    [systemRole, setSystemRole] = useState<"admin" | "user" | null>(null),
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
  const editingRef=useRef(false);editingRef.current=context?.kind==="edit";
  const notify = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  useEffect(() => {
    drafts.current={};mentionDrafts.current={};mentions.current=[];
    draftValue.current="";setDraftValue("");
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
      if (selected) saved[selected] = draftValue.current;
      try { sessionStorage.setItem(`update-drafts:${me.id}`, JSON.stringify(saved)); }
      catch { if (Object.values(saved).some(text => text.length)) event.preventDefault(); }
    };
    window.addEventListener("beacon:before-update", save);
    return () => window.removeEventListener("beacon:before-update", save);
  }, [me?.id, selected, context, busy]);
  const restored=useRef(false), refreshingMe=useRef(false);
  const refreshMe = useCallback(async () => {
    if(refreshingMe.current)return;refreshingMe.current=true;
    if(!restored.current){
      restored.current=true;
      const cached=await restoreAccount();
      if(cached){setMe(cached);setLoading(false);}
    }
    try {
      const identity=await api<User>("me");
      setMe(previous=>JSON.stringify(previous)===JSON.stringify(identity)?previous:identity);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else notify(e);
    } finally {
      setLoading(false);refreshingMe.current=false;
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
  useEffect(() => {
    if(pathname!=="/admin/groups"||me?.role!=="admin")return;
    let active=true;
    void api<Group[]>("admin/groups").then(value=>{if(active)setGroups(value);}).catch(error=>{if(active)notify(error);});
    return ()=>{active=false;};
  },[pathname,me?.role]);
  const historyRevisions=useRef(new Map<string,number>());
  function acceptHistoryRevision(id:string,revision:number){
    const previous=historyRevisions.current.get(id)??0;if(revision<previous)return false;
    historyRevisions.current.set(id,revision);
    if(revision>previous&&selectedRef.current===id){
      historyVersion.current++;messagesRef.current=[];setMessages([]);offlineWindowRef.current=null;setOfflineWindow(null);setHasMore(false);
      aroundBusy.current=false;historicalRef.current=false;setHistorical(false);jumpRequest.current=null;setPinsRevision(value=>value+1);setSearchRevision(value=>value+1);
    }
    return true;
  }
  const refreshLists = useCallback(async () => {
    const owner=localAccount();
    const [cs, us] = await Promise.all([
      api<Chat[]>("chats"),
      api<User[]>("users"),
    ]);
    if(localAccount()!==owner)return;
    const currentChats=cs.map(chat=>({...chat,historyRevision:Math.max(chat.historyRevision??0,historyRevisions.current.get(chat.id)??0)}));
    let reset=false;
    for(const chat of currentChats){if((chat.historyRevision??0)>(historyRevisions.current.get(chat.id)??0)&&chat.id===selectedRef.current)reset=true;acceptHistoryRevision(chat.id,chat.historyRevision??0);}
    setChats(previous=>JSON.stringify(previous)===JSON.stringify(currentChats)?previous:currentChats);
    if(reset&&selectedRef.current)void refreshHistory(selectedRef.current).catch(notify);
    setUsers(previous=>JSON.stringify(previous)===JSON.stringify(us)?previous:us);
  }, []);
  const refreshHistory = useCallback(async (id: string, older = false) => {
    if (older) setHistoryBusy(true);
    try {
      const version=historyVersion.current;
      if (aroundBusy.current || jumpRequest.current?.chatId===id) return;
      const gap=offlineWindowRef.current;
      const first = gap?.hasMoreUnread ? messagesRef.current.find(m=>m.id===gap.unreadStartId) : messagesRef.current[0];
      const through = historicalRef.current && !older ? messagesRef.current.at(-1) : undefined;
      const forward = !!first && !older;
      let cursor = first,
        more = true,
        inclusive = true;
      let result: { messages: Message[]; hasMore: boolean;historyRevision?:number } = {
        messages: [],
        hasMore: false,
      };
      const collected: Message[] = [];
      do {
        const query = cursor
          ? `?${forward ? "after" : "before"}Id=${cursor.id}&${forward ? "after" : "before"}At=${encodeURIComponent(cursor.createdAt)}${forward && inclusive ? "&inclusive=true" : ""}${through ? `&throughId=${through.id}` : ""}`
          : "";
        result = await api<{ messages: Message[]; hasMore: boolean;historyRevision?:number }>(
          `chats/${id}/messages${query}`,
        );
        const revision=result.historyRevision??0,known=historyRevisions.current.get(id)??0;
        if(revision<known)return;
        if(revision>known){acceptHistoryRevision(id,revision);void refreshLists().then(()=>refreshHistory(id)).catch(notify);return;}
        if (selectedRef.current !== id || historyVersion.current!==version) return;
        collected.push(...result.messages);
        more = forward && result.hasMore;
        cursor = result.messages.at(-1)!;
        inclusive = false;
      } while (more && cursor);
      result.messages = collected;
      if (!forward) setHasMore(result.hasMore);
      const previousLast=messagesRef.current.at(-1),nextLast=result.messages.at(-1);
      const hasNewMessages=!!nextLast&&(!previousLast||nextLast.createdAt>previousLast.createdAt||(nextLast.createdAt===previousLast.createdAt&&nextLast.id>previousLast.id));
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
      if (!older && hasNewMessages && initialScroll.current!==id && nearBottom && !historicalRef.current)
        setTimeout(
          () => {if(selectedRef.current===id&&historyVersion.current===version&&!historicalRef.current)feed.current?.scrollTo({top:feed.current.scrollHeight});},
          50,
        );
    } finally {
      if (older) setHistoryBusy(false);
    }
  }, []);
  const openChat = (id: string) => {
    // Selecting the active conversation must not clear history, drafts or context:
    // React does not reload the selected-chat effect for an unchanged ID.
    if(selectedRef.current===id){
      if(pathname!==`/chats/${id}`||legacyChat)void navigate({to:"/chats/$chatId",params:{chatId:id},search:{},replace:!!legacyChat});
      return;
    }
    draftSync.current.flush();
    setEmojiOpen(false);
    if (selectedRef.current && context?.kind!=="edit") { drafts.current[selectedRef.current] = draftValue.current; mentionDrafts.current[selectedRef.current]=mentions.current; }
    historyVersion.current++;aroundBusy.current=false;historicalRef.current=false;setHistorical(false);
    initialScroll.current=id;positionedUnread.current=false;interactedWithHistory.current=false;
    setSelected(id);
    selectedRef.current = id;
    setMessages([]);setOfflineWindow(null);offlineWindowRef.current=null;
    messagesRef.current = [];
    setDraft(drafts.current[id] ?? "",false);
    mentions.current=mentionDrafts.current[id]??[];
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
        const cached=await readCache<Chat[]>("chats");
        const list=cached??await api<Chat[]>("chats");
        if (!live) return;
        if (!list.some(c=>c.id===id)) throw new Error("У вас больше нет доступа к этой переписке");
        setChats(list);openChatRef.current(id);
      }catch(e){notify(e)}
    };
    const listener=(event:MessageEvent)=>{
      if(event.data?.type==="beacon:open-chat")void open(event.data.chatId);
      if(event.data?.type==="beacon:calls-changed")window.dispatchEvent(new Event("beacon:calls-changed"));
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
    const storageError=()=>notify(new Error("Не удалось сохранить данные на устройстве. Проверьте свободное место и настройки браузера."));
    window.addEventListener("beacon:storage-error",storageError);
    const accountChanged=()=>location.reload();
    window.addEventListener("beacon:account-changed",accountChanged);
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
      window.removeEventListener("beacon:storage-error",storageError);
      window.removeEventListener("beacon:account-changed",accountChanged);
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
  useEffect(()=>{
    if(!me)return;
    const owner=me.id;let live=true;setChats([]);setUsers([]);
    void Promise.all([readCache<Chat[]>("chats"),readCache<User[]>("users")]).then(([cs,us])=>{
      if(!live||localAccount()!==owner)return;
      if(cs)setChats(cs);if(us)setUsers(us);
    });
    return()=>{live=false;};
  },[me?.id]);
  useEffect(() => {
    if (!me?.firstName || !me.lastName) return;
    void refreshLists().catch(notify);
    const s = io(import.meta.env.VITE_SOCKET_URL || undefined, {
      withCredentials: true,
    });
    setOnline(false);
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
    s.on("calls.changed",()=>window.dispatchEvent(new Event("beacon:calls-changed")));
    s.on("profile.changed", ({ userId }: { userId: string }) => {
      void refreshLists().catch(notify);
      if (userId === meRef.current?.id) void refreshMe();
    });
    s.on("chat.changed", ({ chatId }: { chatId: string }) => {
      setSearchRevision(value=>value+1);
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
  useEffect(()=>{
    if(context&&messages.some(m=>m.id===context.message.id&&m.type==="deleted")){
      if(context.kind==="edit"){setDraft(drafts.current[context.message.chatId]??"",false);mentions.current=mentionDrafts.current[context.message.chatId]??[];}
      setContext(null);
    }
    if(target&&messages.some(m=>m.id===target.id&&m.type==="deleted")){setTarget(null);setModal(null);}
  },[messages,context,target]);
  useEffect(()=>{setPhotoView(null);setAttachmentsOpen(false);setReadDetails(null);},[me?.id]);
  useOfflineSync(me?.id,section==="chats"?selected:null,socket);
  useEffect(()=>{
    const root=document.documentElement;
    const canvas=getComputedStyle(root).getPropertyValue("--canvas").trim()||"#f5f2ed";
    const color=!me||(section==="chats"&&selected)?canvas:section==="profile"||section==="admin"?"#f6f7fb":["materials","storage","more"].includes(section)?"#ffffff":"#f7f8fb";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content",color);
    root.style.setProperty("--system-background",color);
  },[section,selected,!!me]);
  const [selectedChatIds,setSelectedChatIds]=useState<string[]>([]);
  const toggleChatSelection=(id:string)=>setSelectedChatIds(previous=>previous.includes(id)?previous.filter(value=>value!==id):previous.length<100?[...previous,id]:previous);
  useEffect(()=>{setSelectedChatIds([]);},[section,me?.id]);
  useEffect(()=>{setSelectedChatIds(previous=>{const next=previous.filter(id=>chats.some(chat=>chat.id===id));return next.length===previous.length?previous:next;});},[chats]);
  const listRows=useRef<HTMLDivElement>(null);
  const chatFolders=useChatFolders(me?.id,socket,notify);
  const draftSync=useDraftSync(me?.id,socket,`${me?.firstName}/${me?.lastName}`,(id,value)=>{
    drafts.current[id]=value.text;mentionDrafts.current[id]=value.mentions;
    if(selectedRef.current===id&&!editingRef.current){draftValue.current=value.text;setDraftValue(value.text);mentions.current=value.mentions;}
  });
  const presence=usePresence(me?.id,socket,`${me?.firstName}/${me?.lastName}`);
  useTouchSwipe(feed,{enabled:device==="mobile"&&!loading&&!!me?.firstName&&!!me?.lastName&&section==="chats"&&!!selected&&chats.some(chat=>chat.id===selected)&&!selectionMode,scope:selected??"",direction:"left",
    target:element=>{
      if(element.closest("a,input,textarea,select,video,audio,[role=slider],[contenteditable=true]"))return null;
      const button=element.closest("button,[role=button]");if(button&&!button.matches(".message-photo-open"))return null;
      return element.closest<HTMLElement>("[data-message-id]");
    },
    progress:(distance,element,active)=>{
      if(active){element.dataset.swipeActive="true";element.dataset.swipeClaimed="true";element.style.setProperty("--swipe-x",`${Math.max(-72,Math.min(0,distance))}px`);}
      else{delete element.dataset.swipeActive;element.style.removeProperty("--swipe-x");}
    },
    swipe:(_direction,element)=>{const message=messagesRef.current.find(item=>item.id===element.dataset.messageId);if(message&&message.type!=="deleted")chooseContext("reply",message);},
  });
  useTouchSwipe(listRows,{enabled:device==="mobile"&&!loading&&!!me?.firstName&&!!me?.lastName&&section==="chats"&&!selected&&!searchOpen&&!selectedChatIds.length,direction:"both",
    target:element=>element.closest("a,input,textarea,select,[contenteditable=true]")?null:listRows.current,
    swipe:direction=>{const ids=["all",...chatFolders.folders.map(folder=>folder.id)],index=ids.indexOf(chatFolders.active),next=index+(direction==="left"?1:-1);if(next>=0&&next<ids.length)chatFolders.setActive(ids[next]);},
  });

  useEffect(()=>{setSelectedMessages(ids=>ids.filter(id=>!messages.some(m=>m.id===id&&m.type==="deleted")));},[messages]);
  const {receipts,activity,recording,activityText} = useChatFeatures(me?.id,selected,messages,chats,feed,socket,refreshLists,`${me?.firstName}/${me?.lastName}`);
  useEffect(()=>{
    let live=true;setChatMembers([]);
    if(selected&&me)void api<{members:User[]}>(`chats/${selected}/members`).then(value=>{if(live&&Array.isArray(value.members))setChatMembers(value.members);}).catch(()=>{});
    return()=>{live=false;};
  },[selected,me?.id,chats]);
  useEffect(()=>{
    const request=jumpRequest.current;
    if(!request||selected!==request.chatId)return;
    void loadAround(request.chatId,request.messageId).catch(notify).finally(()=>{if(jumpRequest.current===request)jumpRequest.current=null;});
  },[selected]);
  // Position cached history before paint. Prefer the latest unread incoming
  // message, otherwise the end; subsequent refreshes preserve the reading position.
  useLayoutEffect(()=>{
    if(section!=="chats"){initialScroll.current=selected;return;}
    const chat=chats.find(item=>item.id===selected);
    // Fresh chat metadata can reveal unread messages after a stale cached list
    // was painted. Reposition once, unless the user has already begun browsing.
    const unreadArrived=!!chat?.unread&&!positionedUnread.current&&!interactedWithHistory.current;
    if(!selected||(!unreadArrived&&initialScroll.current!==selected)||!feed.current)return;
    if(historicalRef.current||aroundBusy.current||jumpRequest.current?.chatId===selected)return;
    if(!messages.length&&!pending.some(item=>item.chatId===selected))return;
    const unreadId=chat?.unread ? chat.lastUnreadMessageId??messages.findLast(message=>message.authorId!==me?.id&&message.type!=="deleted")?.id : undefined;
    if(unreadId&&!messages.some(message=>message.id===unreadId)){
      void loadAround(selected,unreadId).catch(notify);return;
    }
    if(unreadId){document.getElementById(`message-${unreadId}`)?.scrollIntoView({block:"start"});positionedUnread.current=true;}
    else feed.current.scrollTop=feed.current.scrollHeight;
    initialScroll.current=null;
  },[selected,messages,pending,chats,section]);
  useEffect(() => {
    if(!selected||!me)return;
    let live=true;
    void (async()=>{
      const snapshot=await readCache<OfflineSnapshot>(`history/${selected}`);
      const cached=snapshot?.messages;
      if(!live||aroundBusy.current||historicalRef.current||jumpRequest.current?.chatId===selected)return;
      if(cached&&acceptHistoryRevision(selected,snapshot?.historyRevision??0)){setMessages(cached);messagesRef.current=cached;setOfflineWindow(snapshot!);offlineWindowRef.current=snapshot!;setHasMore(snapshot!.hasMoreRead||snapshot!.hasMoreUnread);}
      try{await refreshHistory(selected);}catch(error){if(live&&navigator.onLine)notify(error);}
    })();
    return()=>{live=false;};
  }, [selected,me?.id]);
  useEffect(()=>{
    if(!selected)return;
    let live=true;
    const updated=(event:Event)=>{if((event as CustomEvent<{chatId:string}>).detail.chatId!==selected)return;void readCache<OfflineSnapshot>(`history/${selected}`).then(snapshot=>{
      if(!live||!snapshot)return;
      const oldRevision=historyRevisions.current.get(selected)??0;
      if(!acceptHistoryRevision(selected,snapshot.historyRevision??0))return;
      if((snapshot.historyRevision??0)>oldRevision){messagesRef.current=snapshot.messages;setMessages(snapshot.messages);}
      setOfflineWindow(snapshot);offlineWindowRef.current=snapshot;
      const byId=new Map(snapshot.messages.map(m=>[m.id,m]));
      setMessages(previous=>{
        let changed=false;
        const next=previous.map(message=>{
          const cached=byId.get(message.id);
          if(!cached||JSON.stringify(cached)===JSON.stringify(message))return message;
          changed=true;return cached;
        });
        return changed?next:previous;
      });
    });};
    window.addEventListener("beacon:history-updated",updated);
    return()=>{live=false;window.removeEventListener("beacon:history-updated",updated);};
  },[selected]);
  const [queueReady,setQueueReady]=useState<string|null>(null),[retryTick,setRetryTick]=useState(0);
  const flushing=useRef(false),retryAfter=useRef(new Map<string,number>());
  useEffect(()=>{
    setQueueReady(null);setPending([]);
    if(!me)return;
    const owner=me.id;let live=true;
    void (async()=>{
      try{
        // Migrate the previous per-tab queue without changing its idempotency keys.
        let legacy:Pending[]=[];
        try{const value=JSON.parse(sessionStorage.getItem(`pending:${owner}`)??"[]");if(Array.isArray(value))legacy=value;}catch{/* IndexedDB remains usable when sessionStorage is blocked. */}
        if(Array.isArray(legacy))for(const item of legacy)if(item?.clientMessageId&&!item.stickerId&&!item.forwardId&&!item.forwards)await enqueue(owner,item);
        const saved=await queued(owner);
        if(live&&localAccount()===owner){setPending(previous=>[...new Map([...saved,...(Array.isArray(legacy)?legacy.filter(item=>item?.stickerId||item?.forwardId||item?.forwards):[]),...previous].map(item=>[item.clientMessageId,item])).values()]);setQueueReady(owner);}
      }catch{storageProblem();if(live)setQueueReady(owner);}
    })();
    return()=>{live=false;};
  },[me?.id]);
  useEffect(()=>{
    if(me&&queueReady===me.id)try{sessionStorage.setItem(`pending:${me.id}`,JSON.stringify(pending.filter(item=>item.stickerId||item.forwardId||item.forwards)));}catch{/* Non-text pending items retain their previous per-tab behavior. */}
  },[pending,queueReady,me?.id]);
  useEffect(()=>{if(!pending.some(item=>!item.failed))return;const timer=setInterval(()=>setRetryTick(n=>n+1),5000);return()=>clearInterval(timer);},[pending]);
  async function deliver(item: Pending) {
    const owner=meRef.current?.id,generation=localGeneration();
    if(!owner||sending.current.has(item.clientMessageId))return false;
    sending.current.add(item.clientMessageId);
    try {
      if(item.forwards)await api(`chats/${item.chatId}/forward`,"POST",{messages:item.forwards});
      else await api(`chats/${item.chatId}/messages`,"POST",item);
      if(localAccount()!==owner||localGeneration()!==generation)return false;
      await acknowledge(owner,item.clientMessageId);
      setPending(ps=>ps.filter(p=>p.clientMessageId!==item.clientMessageId));
      await refreshLists().catch(()=>{});
      if(selectedRef.current===item.chatId)await refreshHistory(item.chatId).catch(()=>{});
      return true;
    } catch(error) {
      if(localAccount()!==owner||localGeneration()!==generation)return false;
      const permanent=error instanceof ApiError&&[400,403,404,409,413,422].includes(error.status);
      retryAfter.current.set(item.clientMessageId,Date.now()+10000);
      const next={...item,failed:permanent};
      if(!item.stickerId&&!item.forwardId&&!item.forwards)await enqueue(owner,next).catch(storageProblem);
      setPending(ps=>ps.map(p=>p.clientMessageId===item.clientMessageId?next:p));
      if(permanent)notify(error);
      return false;
    } finally {sending.current.delete(item.clientMessageId);}
  }
  useEffect(()=>{
    if(!networkAvailable||!me||queueReady!==me.id||flushing.current||!pending.some(p=>!p.failed&&(retryAfter.current.get(p.clientMessageId)??0)<=Date.now()))return;
    flushing.current=true;
    const generation=localGeneration();
    void (async()=>{
      try{
        await api("me","GET",undefined,true);
        for(const item of pending){
          if(localGeneration()!==generation)break;
          if(!item.failed&&(retryAfter.current.get(item.clientMessageId)??0)<=Date.now())if(!await deliver(item))break;
        }
      }catch{/* Offline or expired session: never flush on a cached identity alone. */}
      finally{flushing.current=false;}
    })();
  },[pending,networkAvailable,retryTick,queueReady,me?.id]);
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
  useEffect(() => { setPhotos([]); setRecordingKind(null); setAttachment(null);setDeleting(null);setBatchDeleting(null);setSelectionMode(false);setSelectedMessages([]);setForwardSources([]);setPhotoView(null);setAttachmentsOpen(false);setReadDetails(null); }, [selected]);
  async function submitMessage(e: FormEvent) {
    e.preventDefault();
    if (!selected || (!draftValue.current.trim() && !photos.length) || busy || queueReady!==me?.id) return;
    activity(null);
    if (photos.length && context?.kind !== "edit") {
      const chatId = selected;
      setBusy(true);
      try {
        const form = new FormData();
        photos.forEach(photo => form.append("file", photo)); form.set("chatId", chatId);
        form.set("clientMessageId", photoMessageId.current); form.set("text", draftValue.current); form.set("mentions",JSON.stringify(mentions.current));
        if (context?.message.id) form.set("replyToId", context.message.id);
        const response = await fetch("/api/photos", { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
        if (response.status === 401) window.dispatchEvent(new Event("beacon:unauthorized"));
        if (!response.ok) throw new Error((await response.json()).error || "Не удалось отправить фото");
        drafts.current[chatId] = "";
        mentionDrafts.current[chatId]=[];draftSync.current.change(chatId,{text:"",mentions:[]});
        if (selectedRef.current === chatId) { setPhotos([]); setDraft(""); setContext(null); }
        await refreshHistory(chatId); await refreshLists();
      } catch (e) { notify(e); } finally { setBusy(false); }
      return;
    }
    if (context?.kind === "edit") {
      setBusy(true);
      try {
        await api(`messages/${context.message.id}`, "PATCH", { text: draftValue.current, mentions: mentions.current });
        setContext(null);
        setDraft(drafts.current[selected] ?? "",false);
        mentions.current=mentionDrafts.current[selected]??[];
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
      text: draftValue.current,
      mentions: [...mentions.current],
      replyToId: context?.message.id,
    };
    setBusy(true);
    try{await enqueue(me!.id,p);}catch(error){storageProblem();notify(new Error("Сообщение не сохранено. Текст оставлен в поле ввода."));return;}finally{setBusy(false);}
    setPending((ps) => [...ps, p]);
    setDraft("");
    drafts.current[selected] = "";
    setContext(null);
  }
  function queueSticker(sticker: Sticker, removeTrigger = false) {
    if (!selected || busy || context?.kind === "edit") return;
    setPending(items => [...items, { chatId: selected, clientMessageId: v7(), text: `Стикер: ${sticker.label}`, stickerId: sticker.id, replyToId: context?.kind === "reply" ? context.message.id : undefined }]);
    if (removeTrigger) {
      const query = stickerSuggestionQuery(draftValue.current);
      const next = query ? draftValue.current.trimEnd().slice(0, -query.length) : draftValue.current;
      setDraft(next); drafts.current[selected] = next;
    }
    setContext(null);
  }
  async function reaction(emoji: string, message = target) {
    if (!message) return;
    try {
      await api(`messages/${message.id}/reaction`, "PATCH", {
        emoji,
        remove: message.reactions.some(
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
  function highlightMessage(id:string) {
    setTimeout(()=>{const node=document.getElementById(`message-${id}`);node?.scrollIntoView({block:"center"});node?.classList.add("highlight");setTimeout(()=>node?.classList.remove("highlight"),1800);},80);
  }
  async function loadAround(chatId:string,messageId:string) {
    initialScroll.current=null;interactedWithHistory.current=true;
    setSelectionMode(false);setSelectedMessages([]);
    const version=++historyVersion.current;aroundBusy.current=true;
    try {
      const result=await api<{messages:Message[];hasMore:boolean}>(`chats/${chatId}/messages?aroundId=${messageId}`);
      if(selectedRef.current!==chatId || historyVersion.current!==version)return;
      historicalRef.current=true;setHistorical(true);messagesRef.current=result.messages;setMessages(result.messages);setHasMore(result.hasMore);highlightMessage(messageId);
    } finally { if(historyVersion.current===version)aroundBusy.current=false; }
  }
  async function removeMessage() {
    if(!deleting||deleteBusy)return;
    setDeleteBusy(true);
    try {
      await api(`messages/${deleting.id}`,"DELETE");
      if(context?.message.id===deleting.id){setContext(null);setDraft(drafts.current[deleting.chatId]??"");}
      if(target?.id===deleting.id){setModal(null);setTarget(null);}
      setDeleting(null);setSearchRevision(value=>value+1);await refreshLists();
      if(selectedRef.current===deleting.chatId)await refreshHistory(deleting.chatId);
    }catch(error){notify(error);}finally{setDeleteBusy(false);}
  }
  async function jump(message: Message) {
    if(!message.replyToId||!selected)return;
    if(document.getElementById(`message-${message.replyToId}`))highlightMessage(message.replyToId);
    else try{await loadAround(selected,message.replyToId);}catch(e){notify(e);}
  }
  async function openSearchMessage(hit:SearchHit) {
    if(selectedRef.current===hit.chatId){try{await loadAround(hit.chatId,hit.id);}catch(e){notify(e);}return;}
    jumpRequest.current={chatId:hit.chatId,messageId:hit.id};openChat(hit.chatId);
  }
  function chooseMention(user:User,start:number,end:number) {
    const label=`@${user.name}`, next=draftValue.current.slice(0,start)+label+" "+draftValue.current.slice(end);
    if(next.length>10000)return;
    const nextMentions=[...moveMentions(draftValue.current,next,mentions.current).filter(mention=>mention.start+mention.length<=start||mention.start>=start+label.length),{userId:user.id,start,length:label.length}];
    setDraft(next,true,nextMentions);
    const position=start+label.length+1;setMentionCursor(position);
    requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(position,position);});
  }
  function beginSearch(scope?:{id:string;name:string}) {
    setSearchScope(scope);setSearchOpen(true);if(section!=="chats")setSection("chats");
    if(device==="mobile")closeChat();
  }
  const current = chats.find((c) => c.id === selected);
  // Unrelated list, presence and dialog updates must not recreate the entire history.
  const historyMarkup=useMemo(()=>{

    if(!me||!current||!selected)return null;
    return (messages.filter(message=>message.type!=="deleted").map((m, i, visibleMessages) => {
                      const previous=visibleMessages[i-1];
                      const continued=!!previous&&previous.authorId===m.authorId&&new Date(previous.createdAt).toDateString()===new Date(m.createdAt).toDateString()&&!(offlineWindow?.hasMoreUnread&&m.id===offlineWindow.unreadStartId);
                      return (
                      <div key={m.id} id={`message-${m.id}`}>
                        <>
                          {offlineWindow?.hasMoreUnread&&m.id===offlineWindow.unreadStartId&&<div className="offline-history-note">Часть истории между этими сообщениями ещё не загружена.{networkAvailable&&<Button className="text-button" type="button" onClick={()=>void loadAround(selected,m.id).catch(notify)}>Загрузить пропущенную историю</Button>}</div>}
                          {(i === 0 ||
                            new Date(
                              visibleMessages[i - 1].createdAt,
                            ).toDateString() !==
                              new Date(m.createdAt).toDateString()) && (
                            <div className="date-divider">
                              <span>
                                {new Date(m.createdAt).toLocaleDateString("ru")}
                              </span>
                            </div>
                          )}
                        </>
                        <MessageActions
                          id={m.id} enabled={m.type!=="deleted"&&!selectionMode} pinned={!!m.pinned} selecting={selectionMode} textual={m.type==="text"}
                          className={`message-group ${continued?"continued-message":""} ${m.authorId === me.id ? "outgoing" : ""} ${selectedMessages.includes(m.id)?"selected-message":""} ${selectionMode?"selectable-message":""}`}
                          reply={()=>chooseContext("reply",m)}
                          copy={m.content.text||m.content.name?()=>{const text=m.content.text||m.content.name||"";if(!navigator.clipboard){notify(new Error("Копирование недоступно в этом браузере"));return;}void navigator.clipboard.writeText(text).catch(notify);}:undefined}
                          edit={m.authorId===me.id&&["text","photo"].includes(m.type)?()=>chooseContext("edit",m):undefined}
                          forward={()=>{setForwardSources([m]);setTarget(null);setModal("forward");}}
                          pin={()=>void togglePin(m)} select={()=>{setSelectionMode(true);toggleSelected(m.id);}}
                          remove={m.authorId===me.id?()=>setDeleting(m):undefined}
                          reaction={()=>{setTarget(m);setModal("reaction");}} quickReaction={emoji=>void reaction(emoji,m)}
                        >
                          {selectionMode&&m.type!=="deleted"&&<input type="checkbox" className="message-selection" aria-label={`Выбрать сообщение ${m.authorName}: ${(m.content.text||m.content.name||"Вложение").slice(0,60)}`} checked={selectedMessages.includes(m.id)} disabled={!selectedMessages.includes(m.id)&&selectedMessages.length>=100} onChange={()=>toggleSelected(m.id)}/>}
                          <div className="message-avatar">
                            {!continued&&<Avatar name={m.authorId===me.id?me.name:m.authorName}
                              image={m.authorId===me.id?me.image:users.find(u=>u.id===m.authorId)?.image??m.authorImage} extra="green"/>}
                          </div>
                          <div className="group-body">
                            <div className="message-heading">
                              {!continued&&<div className="author">{m.authorId===me.id?me.name:users.find(u=>u.id===m.authorId)?.name??m.authorName}</div>}
                              <div className="message-meta">
                                {current.kind!=="saved"&&m.type!=="deleted"&&m.authorId===me.id&&<DeliveryStatus receipts={receipts} message={m} open={()=>setReadDetails(m)}/>}
                                <time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleTimeString("ru",{hour:"2-digit",minute:"2-digit"})}</time>
                              </div>
                            </div>
                            <div className="bubble-row">
                              <div className={`bubble ${["text","photo","sticker"].includes(m.type)?"flat-message":""} ${m.type === "sticker" ? "sticker-bubble" : ""}`}>
                                {m.forwardedFrom && (
                                  <div className="forwarded">
                                    Переслано · {m.forwardedFrom.authorName}
                                  </div>
                                )}
                                {m.reply && (
                                  <Button
                                    className="message-quote"
                                    onClick={() => void jump(m)}
                                  >
                                    {m.reply.authorName}: {m.reply.text}
                                  </Button>
                                )}
                                <span className="bubble-text">
                                  {renderMessage(m.type, m.content, me.id, id=>{if(id!==me.id)void startDirectChat(id);}, index=>setPhotoView({chatId:m.chatId,messageId:m.id,index}))}
                                </span>
                                {current.kind==="direct"&&<span className="message-inline-meta">
                                  <time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleTimeString("ru",{hour:"2-digit",minute:"2-digit"})}</time>
                                  {m.authorId===me.id&&<DeliveryStatus receipts={receipts} message={m} open={()=>setReadDetails(m)}/>}
                                </span>}
                                {m.editedAt && <span className="message-edited" title={new Date(m.editedAt).toLocaleString("ru")}>Изменено</span>}

                              </div>
                            </div>
                            {m.type!=="deleted"&&!selectionMode&&!!m.reactions.length&&<div className="message-tools">
                              {[
                                ...new Set(m.reactions.map((r) => r.emoji)),
                              ].map((emoji) => (
                                <Button
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
                                </Button>
                              ))}
                            </div>}
                          </div>
                        </MessageActions>
                      </div>
                    );}));
  },[messages,me,users,receipts,selected,selectionMode,selectedMessages,!!offlineWindow?.hasMoreUnread,offlineWindow?.hasMoreUnread?offlineWindow.unreadStartId:undefined,networkAvailable,current?.kind]);
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
      <Button
        className="text-button"
        onClick={() => setError("")}
        aria-label="Закрыть уведомление"
      >
        ×
      </Button>
    </div>
  );
  if (!me)
    return (
      <div ref={appFrame} className="app" data-device={device}>
        {toast}
        <main className="auth-shell">
          <section className="auth-card minimal">
            {step === "email" ? (
              <>
                <Form className="minimal-auth-form" onSubmit={requestCode}>
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
                    <Button
                      type="submit"
                      className="email-field-action email-submit-action"
                      aria-label="Получить код"
                      title="Получить код на email"
                      disabled={busy || !email.trim()}
                    >
                      <Icon name="next" />
                    </Button>
                  </div>
                </Form>
              </>
            ) : (
              <>
                <div className="code-surface">
                  <Form
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
                    <Button className="sr-only">Проверить код</Button>
                  </Form>
                  <div className="code-navigation">
                    <Button
                      className="code-back"
                      aria-label="Вернуться к вводу email"
                      onClick={() => {
                        setStep("email");
                        setCode("");
                        setError("");
                      }}
                    >
                      <Icon name="back" />
                    </Button>
                  </div>
                </div>
                <div className="auth-extra">
                  <Button
                    className="text-button"
                    disabled={busy || cooldown > 0}
                    onClick={() => void requestCode()}
                  >
                    {cooldown
                      ? `Повторить через ${cooldown} с`
                      : "Отправить код повторно"}
                  </Button>
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

  // The live socket confirms our own connection before the presence lease/query catches up.
  const onlinePeople=[...presence.people.values()].filter(person=>person.userId!==me.id&&person.online).length+(online?1:0);
  const totalPeople=presence.people.size?presence.people.size+(presence.people.has(me.id)?0:1):0;
  const saved=chats.find(c=>c.kind==="saved");
  const allListedChats = chats.filter(c => c.kind!=="saved"&&(c.pinned || c.kind === "group" || c.lastAt));
  const emptyDirectChats = new Map(chats.filter(c => c.kind === "direct" && !c.lastAt && !c.pinned).map(c => [c.peerId, c]));
  const directUserIds = new Set(allListedChats.filter(c => c.kind === "direct").map(c => c.peerId));
  const allAvailableUsers = users.filter(u => u.id !== me.id && !directUserIds.has(u.id));
  const activeFolder=chatFolders.folders.find(folder=>folder.id===chatFolders.active);
  const listedChats=activeFolder?chats.filter(chat=>chat.kind!=="saved"&&activeFolder.chatIds.includes(chat.id)):allListedChats;
  const availableUsers=activeFolder?[]:allAvailableUsers;
  const ensureSaved=async()=>saved??await api<{id:string}>("chats/saved","POST",{});
  const openSaved=async()=>{if(busy)return;setBusy(true);try{const chat=await ensureSaved();await refreshLists();openChat(chat.id);}catch(error){notify(error);}finally{setBusy(false);}};
  const queueForwards=(chatId:string)=>{
    if(!forwardSources.length)return;
    const sources=[...forwardSources].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    setPending(items=>[...items,{chatId,clientMessageId:v7(),text:`Пересылка: ${sources.length} сообщ.`,forwards:sources.map(m=>({forwardId:m.id,clientMessageId:v7()}))}]);
    setModal(null);setForwardSources([]);setSelectedMessages([]);setSelectionMode(false);
  };
  function toggleSelected(id:string){setSelectedMessages(ids=>ids.includes(id)?ids.filter(value=>value!==id):ids.length<100?[...ids,id]:ids);}
  async function togglePin(message:Message){try{await api(`messages/${message.id}/pin`,"PATCH",{pinned:!message.pinned});setPinsRevision(value=>value+1);if(selected)await refreshHistory(selected);}catch(error){notify(error);}}
  const startDirectChat = async (userId: string) => {
    if(userId===me.id){await openSaved();return;}
    if (busy) return;
    setBusy(true);
    try {
      const chat = await api<{ id: string }>("chats", "POST", { kind: "direct", userIds: [userId] });
      await refreshLists();
      openChat(chat.id);
    } catch (e) { notify(e); }
    finally { setBusy(false); }
  };
  async function selectNewConversation(user:User){
    if(busy||user.banned)return;setBusy(true);
    try{const chat=await api<{id:string}>("chats","POST",{kind:"direct",userIds:[user.id]});await refreshLists();toggleChatSelection(chat.id);}catch(error){notify(error);}finally{setBusy(false);}
  }
  const nav = (
    <aside className="nav-rail" aria-label="Основная навигация">
      <Button
        type="button"
        className={`rail-action ${section === "home" ? "active" : ""}`}
        aria-label="Главная"
        onClick={() => setSection("home")}
      >
        <Icon name="home" />
        <span className="rail-tooltip" aria-hidden="true">Главная</span>
      </Button>
      <Button
        className={`rail-action ${section === "chats" ? "active" : ""}`}
        onClick={() => {setSearchOpen(false);setSection("chats");}}
        aria-label="Чаты"
      >
        <Icon name="chats" />
        <span className="rail-tooltip" aria-hidden="true">Чаты</span>
      </Button>
      {([
        ["search", "Поиск"],
        ["materials", "Материалы"],
        ["navigator", "Навигатор"],
        ["storage", "Хранилище"],
      ] as const).filter(([icon]) => me.role === "admin" || (icon !== "storage" && icon !== "materials")).map(([icon, label]) => (
        <Button
          key={icon}
          className={`rail-action ${(icon === "storage" && section === "storage") || (icon === "materials" && section === "materials") ? "active" : ""}`}
          aria-label={label}
          aria-haspopup={icon === "search" || icon === "storage" || icon === "materials" ? undefined : "dialog"}
          onClick={() => icon === "search" ? beginSearch() : icon === "storage" ? setSection("storage") : icon === "materials" ? setSection("materials") : setUpcomingService(label)}
        >
          <Icon name={icon} />
          <span className="rail-tooltip" aria-hidden="true">{label}</span>
        </Button>
      ))}
      {me.role === "admin" && (
        <Button
          className={`rail-action ${section === "admin" ? "active" : ""}`}
          onClick={() => setSection("admin")}
          aria-label="Администрирование"
        >
          <Icon name="settings" />
          <span className="rail-tooltip" aria-hidden="true">Администрирование</span>
        </Button>
      )}
      <span className="rail-spacer" />
      <Button
        className={`rail-action ${section === "profile" ? "active" : ""}`}
        onClick={() => setSection("profile")}
        aria-label="Настройки"
      >
        {me.image ? <Avatar name={me.name} image={me.image} extra="rail-profile-avatar" /> : <Icon name="profile" />}
        <span className="rail-tooltip" aria-hidden="true">Настройки</span>
      </Button>
    </aside>
  );
  const mobileNavigation = (
    <nav className="mobile-bottom" aria-label="Навигация" style={{gridTemplateColumns:"repeat(5, minmax(0, 1fr))"}}>
      <Button className={section==="home"?"active":undefined} aria-current={section==="home"?"page":undefined} onClick={()=>setSection("home")}><Icon name="home"/><span>Главная</span></Button>
      <Button className={section==="materials"?"active":undefined} aria-current={section==="materials"?"page":undefined} onClick={()=>me.role==="admin"?setSection("materials"):setUpcomingService("Материалы")}><Icon name="materials"/><span>Материалы</span></Button>
      <Button className={section==="chats"?"active":undefined} aria-current={section==="chats"?"page":undefined} onClick={()=>{setSearchOpen(false);setSection("chats");}}><Icon name="chats"/><span>Чаты</span></Button>
      <Button className={section==="storage"?"active":undefined} aria-current={section==="storage"?"page":undefined} onClick={()=>me.role==="admin"?setSection("storage"):setUpcomingService("Хранилище")}><Icon name="storage"/><span>Хранилище</span></Button>
      <Button className={section==="more"||section==="profile"||section==="admin"?"active":undefined} aria-current={section==="more"||section==="profile"||section==="admin"?"page":undefined} onClick={()=>setSection("more")}><MoreHorizontal/><span>Ещё</span></Button>
    </nav>
  );
  function chooseEmoji(emoji:string){
    const before=draftValue.current;
    const start=Math.min(emojiSelection.current.start,before.length),end=Math.min(emojiSelection.current.end,before.length);
    if(before.length-(end-start)+emoji.length>10000){notify(new Error("В сообщении может быть до 10 000 символов"));return;}
    setDraft(before.slice(0,start)+emoji+before.slice(end));
    const cursor=start+emoji.length;emojiSelection.current={start:cursor,end:cursor};
    requestAnimationFrame(()=>textarea.current?.setSelectionRange(cursor,cursor));
  }
  function chooseContext(kind: "reply" | "edit", m: Message) {
    if (kind === "edit") {
      if (selected) {drafts.current[selected] = draftValue.current;mentionDrafts.current[selected]=mentions.current;}
      setDraft(m.content.text,false);
      mentions.current=[...(m.content.mentions??[])];
    }
    setContext({ kind, message: m });
    textarea.current?.focus();
  }
  function cancelContext() {
    if (context?.kind === "edit") {setDraft(drafts.current[selected!] ?? "",false);mentions.current=mentionDrafts.current[selected!]??[];}
    setContext(null);
  }
  const chosenMessages=messages.filter(message=>selectedMessages.includes(message.id)&&message.type!=="deleted");
  const copyText=chosenMessages.map(message=>message.content.text||message.content.name||"").filter(Boolean).join("\n\n");
  const cancelSelection=()=>{setSelectionMode(false);setSelectedMessages([]);};
  async function removeSelectedMessages(){
    if(!batchDeleting||deleteBusy)return;
    const items=batchDeleting,removed:string[]=[];setDeleteBusy(true);
    try{
      for(const message of items){await api(`messages/${message.id}`,"DELETE");removed.push(message.id);}
      cancelSelection();
    }catch(error){notify(error);}finally{
      setSelectedMessages(ids=>ids.filter(id=>!removed.includes(id)));setBatchDeleting(null);setDeleteBusy(false);
      if(context&&removed.includes(context.message.id)){setContext(null);if(selected)setDraft(drafts.current[selected]??"",false);}
      setSearchRevision(value=>value+1);
      try{await refreshLists();if(selected)await refreshHistory(selected);}catch(error){notify(error);}
    }
  }
  return (
    <MobileInteractions.Provider value={device==="mobile"}><div ref={appFrame} className="app" data-device={device}>
      {toast}
      <Calls key={me.id} userId={me.id} notify={notify}/>
      {section === "home" ? <div className="home-shell">{nav}<Home name={me.firstName} chats={()=>setSection("chats")} saved={()=>void openSaved()} materials={()=>me.role==="admin"?setSection("materials"):setUpcomingService("Материалы")} storage={()=>me.role==="admin"?setSection("storage"):setUpcomingService("Хранилище")}/>{mobileNavigation}</div> : section === "more" ? <div className="more-shell">{nav}<main className="more-main">
        <h1>Ещё</h1>
        <Button className="more-profile" onClick={()=>void navigate({to:"/settings/profile",search:{}})}><Avatar name={me.name} image={me.image}/><span><strong>{me.name}</strong><small>Мой профиль</small></span><ChevronRight/></Button>
        <nav className="more-links" aria-label="Дополнительные разделы">
          <Button onClick={()=>void navigate({to:"/settings/stickers",search:{}})}><Icon name="sticker"/><span>Мои стикеры</span><ChevronRight/></Button>
          <Button onClick={()=>setSection("profile")}><Icon name="settings"/><span>Настройки</span><ChevronRight/></Button>
          {me.role==="admin"&&<Button onClick={()=>setSection("admin")}><Icon name="settings"/><span>Администрирование</span><ChevronRight/></Button>}
        </nav>
      </main>{mobileNavigation}</div> : section === "materials" ? <div className="materials-shell">{nav}<Materials back={() => setSection("chats")} />{mobileNavigation}</div> : section === "storage" ? <div className="storage-shell">{nav}<Storage />{mobileNavigation}</div> : section === "chats" ? (
        <div className={`chat-shell ${selected ? "has-chat" : ""}`} data-chat-kind={current?.kind}>
          {nav}
          {searchOpen ? <SearchPanel key={searchScope?.id??"global"} revision={searchRevision} scope={searchScope} users={users} chats={chats} openChat={openChat} openPerson={id=>void startDirectChat(id)} openMessage={hit=>void openSearchMessage(hit)} close={()=>setSearchOpen(false)}/> : <section className="chat-list">
            <header className="list-header compact-list-header">
              {selectedChatIds.length?<ChatListActions chats={chats.filter(chat=>selectedChatIds.includes(chat.id))} folders={chatFolders.folders} cancel={()=>setSelectedChatIds([])} refresh={async action=>{if(action==="delete-own"&&context?.message.authorId===me.id&&selectedChatIds.includes(context.message.chatId))cancelContext();await refreshLists();await chatFolders.refresh();}} notify={notify}/>:<>
              <h1 className="sr-only">Чаты</h1>
              <Button className="profile-avatar-button" onClick={()=>void navigate({to:"/settings/profile",search:{}})} aria-label="Открыть профиль"><span className="presence-avatar"><Avatar name={me.name} image={me.image} extra="self-avatar warm"/><span className={`online-dot profile-connection-dot ${online?"connected":"connecting"}`} aria-hidden="true"/></span><span className="profile-connection-label" role="status">{online?totalPeople?<><strong className="profile-online-count">{onlinePeople}</strong> из {totalPeople} в сети</>:"Подключено":"Подключается…"}</span></Button>
              <div className="inline-actions">
                  <Button className="icon-button" aria-label="Открыть поиск" onClick={()=>beginSearch()}><Icon name="search"/></Button>
                  <ActionMenu label="Меню списка чатов" icon={<MoreHorizontal/>} triggerClassName="icon-button" className="chat-list-actions" items={[
                    {id:"group",label:"Создать группу",action:()=>{setModal("new");}},
                    {id:"saved",label:"Избранное",action:()=>void openSaved(),disabled:busy},
                  ]}/>
              </div>
              </>}
            </header>
            <FolderTabs folders={chatFolders.folders} active={chatFolders.active} choose={chatFolders.setActive} chats={chats}/>
            <div className="chat-rows" ref={listRows}>
              {listedChats.map((c) => (
                <SelectableChatRow
                  id={c.id} selected={selectedChatIds.includes(c.id)} selecting={!!selectedChatIds.length} toggle={toggleChatSelection}
                  className={`chat-row ${selected === c.id ? "active" : ""}`}
                  key={c.id}
                  open={() => openChat(c.id)}
                >
                  <span className="presence-avatar"><Avatar
                    name={c.name ?? "Чат"}
                    image={c.avatar}
                    extra={c.kind === "group" ? "warm" : ""}
                  />{selectedChatIds.includes(c.id)?<ChatSelectionBadge/>:!selectedChatIds.length&&c.kind==="direct"&&presence.people.get(c.peerId??"")?.online&&<span className="online-dot" aria-label="В сети"/>}</span>
                  <div className="chat-row-main">
                    <div className="chat-row-title">{c.pinned&&<Icon name="pin"/>}{c.name}{c.muted&&<Icon name="bellOff"/>}</div>
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
                    {!!c.unreadMentions && <span className="unread mention-badge" title="Вас упомянули" aria-label="Вас упомянули">@</span>}
                    {c.unread > 0 && <span className="unread">{c.unread}</span>}
                  </div>
                </SelectableChatRow>
              ))}
              {availableUsers.map(u => (
                <SelectableChatRow
                  selectNew={!u.banned?()=>void selectNewConversation(u):undefined} id={emptyDirectChats.get(u.id)?.id} selected={selectedChatIds.includes(emptyDirectChats.get(u.id)?.id??"")} selecting={!!selectedChatIds.length} toggle={toggleChatSelection}
                  className={`chat-row ${selected === emptyDirectChats.get(u.id)?.id ? "active" : ""}`}
                  key={`user:${u.id}`}
                  disabled={(!emptyDirectChats.has(u.id) && u.banned) || busy}
                  open={() => {
                    const existing = emptyDirectChats.get(u.id);
                    if (existing) openChat(existing.id);
                    else void startDirectChat(u.id);
                  }}
                >
                  <span className="presence-avatar"><Avatar name={u.name} image={u.image} />{selectedChatIds.includes(emptyDirectChats.get(u.id)?.id??"")?<ChatSelectionBadge/>:!selectedChatIds.length&&!u.banned&&presence.people.get(u.id)?.online&&<span className="online-dot" aria-label="В сети"/>}</span>
                  <div className="chat-row-main">
                    <div className="chat-row-title">{u.name}</div>
                    <div className="chat-row-preview">
                      {u.banned ? "Доступ приостановлен" : presenceText(presence.people.get(u.id),presence.now)}
                    </div>
                  </div>
                </SelectableChatRow>
              ))}
              {activeFolder&&!listedChats.length&&<div className="empty-state"><p>В этой папке пока нет переписок. Добавьте их в настройках папок чатов.</p></div>}
              {!activeFolder&&!chats.length && !availableUsers.length && (
                <div className="empty-state">
                  <div>
                    <h2>Пока нет переписок</h2>
                    <p>Выберите участника или создайте групповой чат.</p>
                    <Button
                      className="primary-button"
                      onClick={() => setModal("new")}
                    >
                      Начать общение
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>}
          <section className="workspace">
            {selected && current ? (
              <>
                <header className={`chat-header ${selectionMode?"selection-header":""}`}>
                  {selectionMode?<>
                    <Button className="selection-cancel" aria-label="Отменить выбор" onClick={cancelSelection}><X/></Button>
                    <div className="selection-toolbar"><span>Выбрано: {selectedMessages.length} / 100</span></div>
                  </>:<>
                  <Button
                    className="back-button"
                    aria-label="Назад к списку"
                    onClick={() => {
                      drafts.current[selected] = draftValue.current;
                      mentionDrafts.current[selected]=mentions.current;
                      closeChat();
                    }}
                  >
                    <Icon name="back" />
                  </Button>
                  <div className="chat-peer-pill">
                  {current.kind==="saved"?<span className="avatar saved-avatar"><Icon name="bookmark"/></span>:<Avatar
                    name={current.name ?? "Чат"}
                    image={current.avatar}
                    extra="warm"
                  />}
                  <div className="chat-header-copy">
                    <Button type="button" className="chat-header-title chat-attachments-title" aria-label="Вложения чата" title="Вложения чата" onClick={()=>setAttachmentsOpen(true)}><span>{current.name}</span><Icon name="file"/></Button>
                    <div className="chat-header-subtitle">
                      {current.kind==="saved"?"Личные заметки":activityText || (current.kind === "group" ? "Групповой чат" : presenceText(presence.people.get(current.peerId??""),presence.now))}
                    </div>
                  </div>
                  </div>
                  {device==="desktop"&&<Button className="icon-button desktop-chat-search" aria-label="Поиск в чате" onClick={()=>beginSearch({id:selected,name:current.name})}><Icon name="search"/></Button>}
                  {current.kind==='direct'&&device==='desktop'&&<><Button className="icon-button desktop-chat-search" aria-label="Аудиозвонок" onClick={()=>startPersonalCall(selected,'audio')}><Phone/></Button><Button className="icon-button desktop-chat-search" aria-label="Видеозвонок" onClick={()=>startPersonalCall(selected,'video')}><Video/></Button></>}
                  <ActionPanel label="Действия с чатом" icon={<Icon name="menu"/>} className="mobile-chat-actions" triggerClassName="mobile-chat-menu-trigger">
                    {current.kind==='direct'&&device==='mobile'&&<><Button className="icon-button" aria-label="Аудиозвонок" onClick={()=>startPersonalCall(selected,'audio')}><Phone/></Button><Button className="icon-button" aria-label="Видеозвонок" onClick={()=>startPersonalCall(selected,'video')}><Video/></Button></>}
                    <Button className="icon-button" aria-label="Вложения чата" onClick={()=>setAttachmentsOpen(true)}><Icon name="file"/></Button>
                    <Button className="icon-button" aria-label={current.pinned?"Открепить чат":"Закрепить чат"} onClick={()=>void api(`chats/${selected}/pin`,"PATCH",{pinned:!current.pinned}).then(()=>refreshLists()).catch(notify)}><Icon name="pin"/></Button>
                    {device==="mobile"&&<Button className="icon-button" aria-label="Поиск в чате" onClick={()=>beginSearch({id:selected,name:current.name})}><Icon name="search"/></Button>}
                    <Button className="icon-button" aria-label="Выбрать сообщения" onClick={()=>{setSelectionMode(value=>!value);setSelectedMessages([]);}}><Icon name="select"/></Button>
                    {current.kind!=="saved"&&<ChatPushToggle key={`${selected}/${current.muted??false}`} chatId={selected} notify={notify}/>}
                    {current.kind==="group"&&<Button className="icon-button" aria-label="Участники и настройки чата" onClick={()=>void loadManagement(selected)}><Icon name="menu"/></Button>}
                  </ActionPanel>
                  </>}
                </header>
                {!selectionMode&&<PinnedMessages key={selected} chatId={selected} socket={socket} connectionKey={`${me.firstName}/${me.lastName}`} changed={pinsRevision} onChanged={(id,pinned)=>setMessages(items=>items.map(m=>m.id===id?{...m,pinned}:m))} jump={id=>void loadAround(selected,id).catch(notify)} notify={notify}/>}
                {!online && (
                  <div className="connection-strip">
                    Нет связи · отправка повторится после подключения
                  </div>
                )}
                {historical && <Button className="history-return text-button" onClick={()=>{historyVersion.current++;historicalRef.current=false;setHistorical(false);messagesRef.current=[];setMessages([]);void refreshHistory(selected).catch(notify);}}>К новым сообщениям</Button>}
                <div className="feed" ref={feed} onWheelCapture={()=>{interactedWithHistory.current=true;}} onTouchStartCapture={()=>{interactedWithHistory.current=true;}} onPointerDownCapture={()=>{interactedWithHistory.current=true;}} onKeyDownCapture={()=>{interactedWithHistory.current=true;}}>
                  <div className="feed-inner">
                    {hasMore && (
                      <Button
                        className="text-button"
                        disabled={historyBusy||!networkAvailable}
                        onClick={() =>
                          void refreshHistory(selected, true).catch(notify)
                        }
                      >
                        {historyBusy ? "Загружаем…" : "Предыдущие сообщения"}
                      </Button>
                    )}
                    {!online&&!messages.length&&<p className="offline-history-note">Переписка ещё не загружена на это устройство. Подключитесь к интернету.</p>}
                    {offlineWindow?.hasMoreUnread&&<p className="offline-history-note">Часть непрочитанных сообщений не сохранена на устройстве. Доступны последние 1000; полная история — с интернетом.</p>}
                    {historyMarkup}
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
                          <div className="message-avatar"><Avatar name={me.name} image={me.image} extra="green"/></div>
                          <div className="group-body">
                            <div className="message-heading"><div className="author">{me.name}</div></div>
                            <div className="bubble-row">
                              <div className="bubble flat-message">
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
                                <Button
                                  onClick={() => {
                                    setPending((ps) =>
                                      ps.map((x) =>
                                        x.clientMessageId === p.clientMessageId
                                          ? { ...x, failed: false }
                                          : x,
                                      ),
                                    );
                                    retryAfter.current.delete(p.clientMessageId);
                                    if(!p.stickerId&&!p.forwards&&!p.forwardId)void enqueue(me.id,{...p,failed:false}).catch(storageProblem);
                                  }}
                                >
                                  Повторить
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
                {selectionMode?<div ref={observeComposerSize} className="composer-dock selection-dock"><div className="selection-actions" role="toolbar" aria-label="Действия с выбранными сообщениями">
                  <Button disabled={chosenMessages.length!==1} onClick={()=>{const message=chosenMessages[0];cancelSelection();chooseContext("reply",message);requestAnimationFrame(()=>textarea.current?.focus());}}><Reply/><span>Ответить</span></Button>
                  <Button disabled={!chosenMessages.length} onClick={()=>{setForwardSources(chosenMessages);setTarget(null);setModal("forward");}}><Forward/><span>Переслать</span></Button>
                  <Button disabled={!copyText} onClick={()=>{if(!navigator.clipboard){notify(new Error("Копирование недоступно в этом браузере"));return;}void navigator.clipboard.writeText(copyText).then(cancelSelection).catch(notify);}}><Copy/><span>Скопировать</span></Button>
                  <Button className="danger" disabled={!chosenMessages.length||chosenMessages.some(message=>message.authorId!==me.id)} onClick={()=>setBatchDeleting(chosenMessages)}><Trash2/><span>Удалить</span></Button>
                </div></div>:<ComposerFrame state={composerState} textarea={textarea} device={device} context={context}>
                  {(draft, mentionCursor) => (
                <div
                  ref={observeComposerSize}
                  className="composer-dock"
                  data-composer-state={context?.kind ?? "input"}
                >
                  <MentionSuggestions draft={draft} cursor={mentionCursor} members={chatMembers} choose={chooseMention}/>
                  {context?.kind !== "edit" && !busy && !photos.length && <StickerSuggestions userId={me.id} text={stickerSuggestionQuery(draft)} choose={sticker => queueSticker(sticker, true)} />}
                  <Form className="composer-open" onSubmit={submitMessage}>
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
                        <Button
                          className="composer-context-close"
                          type="button"
                          onClick={cancelContext}
                          aria-label="Отменить контекст сообщения"
                        >
                          ×
                        </Button>
                      </div>
                    )}
                    {!!photos.length && <div className="photo-previews">{photos.map((photo, index) => <div className="photo-preview" key={index}><PhotoThumbnail file={photo} index={index} /><Button className="photo-preview-remove" type="button" aria-label={`Убрать фото ${index + 1}`} disabled={busy} onClick={() => { photoMessageId.current = v7(); setPhotos(items => items.filter((_, i) => i !== index)); }}><X size={16}/></Button></div>)}</div>}
                    <div className="composer-line-layout" data-has-content={!!draft.trim() || !!photos.length || context?.kind === "edit"}>
                    <div className="composer-body">
                      <label className="sr-only" htmlFor="composer">
                        Сообщение
                      </label>
                      <textarea
                        ref={textarea}
                        disabled={busy && !!photos.length}
                        id="composer"
                        className="composer-input"
                        rows={1}
                        placeholder="Сообщение"
                        value={draft}
                        maxLength={10000}
                        onSelect={e=>setMentionCursor(e.currentTarget.selectionStart)}
                        onBlur={()=>{activity(null);setMentionCursor(-1);}}
                        onChange={(e) => {setDraft(e.target.value);setMentionCursor(e.target.selectionStart);activity(e.target.value.trim()?"typing":null);}}
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
                      {<ActionPanel key={selected} label="Прикрепить" icon={<Icon name="file"/>} className="mobile-attach-actions" triggerClassName="composer-action composer-attach-menu" placement="top start">
                        <div className="composer-attach-options">
                          <Button type="button" disabled={busy || context?.kind === "edit" || !!photos.length} onClick={e => { attachmentInput.current?.click(); }}><Icon name="file" />Файл или видео</Button>
                          <Button type="button" disabled={busy || context?.kind === "edit"} onClick={e => { photoInput.current?.click(); }}><Icon name="photo" />Фото</Button>
                          <Button type="button" disabled={busy || context?.kind === "edit"} onClick={e => { setStickersOpen(true); }}><Icon name="sticker" />Стикер</Button>
                        </div>
                      </ActionPanel>}

                      <input type="file" aria-label="Выбрать файл или видео" ref={attachmentInput} hidden onChange={e=>{
                        const file=e.target.files?.[0];e.target.value="";if(!file||!selected)return;
                        const kind:AttachmentKind=file.type.startsWith("video/")||/\.(mp4|webm|mov|m4v|mkv|avi|mpeg|mpg|ts)$/iu.test(file.name)?"video":"file";
                        if(!file.size||file.size>attachmentLimits[kind]){notify(new Error(`Допустимый размер: ${kind==="video"?"500":"100"} МБ`));return;}
                        setAttachment({file,kind,chatId:selected});
                      }}/>
                      <Button type="button" className="composer-action composer-desktop-extra" aria-label="Прикрепить файл или видео" data-tooltip="Отправить файл или видео" disabled={busy||context?.kind==="edit"||!!photos.length} onClick={()=>attachmentInput.current?.click()}><Icon name="file"/></Button>
                      {(!draft.trim() && !photos.length && context?.kind !== "edit") && <Button type="button" className="composer-action composer-mic" aria-label="Записать голосовое сообщение" data-tooltip="Отправить голосовое сообщение" disabled={busy} onClick={() => setRecordingKind("audio")}><Icon name="mic" /></Button>}
                      <Button type="button" className="composer-action composer-video" aria-label="Записать видеокружок" data-tooltip="Отправить видеокружок" disabled={busy || context?.kind === "edit" || !!photos.length} onClick={() => setRecordingKind("circle")}><Icon name="video" /></Button>
                      <Button type="button" className="composer-action composer-desktop-extra" aria-label="Выбрать стикер" data-tooltip="Отправить стикер" disabled={busy || context?.kind === "edit"} onClick={() => setStickersOpen(true)}><Icon name="sticker" /></Button>
                      <input ref={photoInput} type="file" multiple className="sr-only" aria-label="Выбрать фото" accept="image/jpeg,image/png,image/webp" disabled={busy || context?.kind === "edit"} onChange={e => {
                        const files = Array.from(e.target.files ?? []); e.target.value = "";
                        if (!files.length) return;
                        if (photos.length + files.length > 10) { notify(new Error("Можно отправить до 10 фотографий за раз")); return; }
                        if (files.some(file => !file.size || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) { notify(new Error("Выберите PNG, JPEG или WebP до 5 МБ каждый")); return; }
                        photoMessageId.current = v7(); setPhotos(items => [...items, ...files]);
                      }} />
                      <Button type="button" className="composer-action composer-desktop-extra" aria-label="Прикрепить фото" data-tooltip="Отправить фото" disabled={busy || context?.kind === "edit"} onClick={() => photoInput.current?.click()}><Icon name="photo" /></Button>
                      <Button
                        className="composer-action composer-emoji"
                        type="button"
                        aria-label="Добавить эмодзи" data-tooltip="Добавить эмодзи"
                        disabled={busy}
                        aria-haspopup="dialog"
                        aria-expanded={emojiOpen}
                        onClick={() => {
                          const input=textarea.current;
                          emojiSelection.current={start:input?.selectionStart??draft.length,end:input?.selectionEnd??draft.length};
                          setEmojiOpen(true);
                        }}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="12" cy="12" r="8.5" />
                          <path d="M8.8 10h.1M15.1 10h.1M8.8 14c1.8 1.7 4.6 1.7 6.4 0" />
                        </svg>
                      </Button>
                      {(!!draft.trim() || !!photos.length || context?.kind === "edit") && <Button
                        className="composer-action send-button"
                        data-tooltip={context?.kind==="edit"?"Сохранить изменения":"Отправить сообщение"}
                        disabled={(!draft.trim() && !photos.length) || busy || queueReady!==me.id}
                        aria-label={
                          context?.kind === "edit"
                            ? "Сохранить изменения"
                            : "Отправить сообщение"
                        }
                      >
                        <Icon name="send" />
                      </Button>}
                    </div>
                    </div>
                  </Form>
                </div>
                  )}
                </ComposerFrame>}
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
          {mobileNavigation}
        </div>
      ) : (
        <div className={`admin-shell ${section === "profile" || (section === "admin" && me.role === "admin") ? "administration-shell" : ""} ${!["/admin","/settings"].includes(pathname) ? "has-admin-page" : ""}`}>
          {nav}
          {(section === "profile" || (section === "admin" && me.role === "admin")) && <aside className={`admin-sections ${section === "profile" ? "settings-sections" : ""}`}>
            <header className="admin-sections-heading">
              <Button type="button" className="icon-button admin-mobile-back" aria-label="Назад в Ещё" onClick={() => setSection("more")}><Icon name="back" /></Button>
              <h1>{sectionTitle}</h1>
            </header>
            <nav aria-label={section==="profile"?"Разделы настроек":"Разделы администрирования"}>
              {sectionItems.map(item => <Button type="button" key={item.path}
                className={`admin-section-row ${activeSectionPage.path === item.path ? "active" : ""}`}
                aria-current={activeSectionPage.path === item.path ? "page" : undefined}
                onClick={() => void navigate({ to: item.path, search: {} })}>
                <Icon name={item.icon} /><span>{item.title}</span>
              </Button>)}
            </nav>
          </aside>}
          <main className="settings">
            <header className="admin-header">
              <Button type="button" className="icon-button admin-mobile-back"
                onClick={() => setSection(section === "profile" ? "profile" : "admin")}
                aria-label="Назад к разделам"><Icon name="back" /></Button>
              <div className="admin-title"><h1>{activeSectionPage.title}</h1></div>
            </header>
            <div className="settings-main">
              {section === "profile" ? settingsPage.path === "/settings/security" ? <Security email={me.email} notify={notify}/>
                : settingsPage.path === "/settings/notifications" ? <PushSettings notify={notify}/>
                : settingsPage.path === "/settings/stickers" ? <StickerAdmin key="mine" scope="mine" notify={notify}/>
                : settingsPage.path === "/settings/folders" ? <FolderSettings folders={chatFolders.folders} chats={chats} refresh={chatFolders.refresh} notify={notify}/>
                : settingsPage.path === "/settings/data" ? <DeviceData notify={notify}/>
                : settingsPage.path === "/settings/about" ? <About/>
                : (
                <>
                  <Profile me={me} refresh={refreshMe} notify={notify} />
                  <Button
                    className="secondary-button"
                    onClick={async () => {
                      await forgetPushDevice().catch(()=>{});
                      await authClient.signOut();
                      await forgetAccount();
                      try{
                        sessionStorage.removeItem(`pending:${me.id}`);
                        sessionStorage.removeItem(`update-drafts:${me.id}`);
                        sessionStorage.removeItem(`beacon:unsynced-drafts:${me.id}`);
                      }catch{/* Logout must work when per-tab storage is blocked. */}
                      setMe(null);
                      setSection("chats");
                      closeChat();
                      setMessages([]);
                      setPending([]);
                    }}
                  >
                    Выйти из аккаунта
                  </Button>
                </>
              ) : me.role !== "admin" ? <p>Этот раздел доступен только администраторам.</p>
              : adminPage.path === "/admin/storage" ? <StorageAdmin />
              : adminPage.path === "/admin/stickers" ? <StickerAdmin key="all" scope="all" notify={notify} />
              : adminPage.path === "/admin/groups" ? (
                <div className="settings-card">
                  <div className="panel-heading">
                    <strong>Группы пользователей</strong>
                    <Button
                      className="primary-button"
                      onClick={async () => {
                        try {
                          setGroups(await api("admin/groups"));
                          setEditGroup(null);
                          setSystemRole(null);
                          setModal("membership");
                        } catch (e) {
                          notify(e);
                        }
                      }}
                    >
                      Управление
                    </Button>
                  </div>
                  <div className="admin-group-list">
                    {systemGroups.map(group=><Button type="button" className="admin-group-item" key={group.role} onClick={()=>{setSystemRole(group.role);setEditGroup(null);setModal("membership");}}>
                      <strong>{group.name}</strong><span className="field-note">Системная группа · Участников: {users.filter(user=>user.role===group.role).length}</span>
                    </Button>)}
                    {groups.map(group=><Button type="button" className="admin-group-item" key={group.id} onClick={()=>{setSystemRole(null);setEditGroup(group);setModal("membership");}}>
                      <strong>{group.name}</strong><span className="field-note">Участников: {group.members.length}</span>
                    </Button>)}
                  </div>
                </div>
              ) : adminPage.path === "/admin/chats" ? (
                <div className="settings-card">
                  <h2>Все групповые чаты</h2>
                  <Button
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
                  </Button>
                  {allGroups.map((c) => (
                    <Button
                      key={c.id}
                      className="secondary-button"
                      onClick={() => void loadManagement(c.id)}
                    >
                      {c.title}
                    </Button>
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
                    <Button
                      className="primary-button"
                      onClick={() => {
                        setEditUser(null);
                        setModal("user");
                      }}
                    >
                      Создать
                    </Button>
                  </div>
                  {users.map((u) => (
                    <Button
                      className="user-row editable"
                      key={u.id}
                      onClick={() => {
                        setEditUser(u);
                        setModal("user");
                      }}
                    >
                      <span className="presence-avatar"><Avatar name={u.name} image={u.image} />{!u.banned&&presence.people.get(u.id)?.online&&<span className="online-dot" aria-label="В сети"/>}</span>
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
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      )}
      {attachmentsOpen&&selected&&current&&<ChatAttachments key={selected} chatId={selected} name={current.name} socket={socket} close={()=>setAttachmentsOpen(false)} photo={setPhotoView} jump={id=>void loadAround(selected,id).catch(notify)}/>}
      {readDetails&&<ReadDetails key={readDetails.id} messageId={readDetails.id} chatId={readDetails.chatId} socket={socket} close={()=>setReadDetails(null)}/>}
      {photoView&&<PhotoViewer key={`${photoView.chatId}:${photoView.messageId}`} target={photoView} socket={socket} close={()=>setPhotoView(null)}/>}
      {batchDeleting&&<Dialog title="Удалить сообщения?" close={()=>{if(!deleteBusy)setBatchDeleting(null);}}><p>Выбранные сообщения ({batchDeleting.length}) будут удалены у всех участников переписки.</p><div className="inline-actions"><Button className="primary-button" disabled={deleteBusy} onClick={()=>void removeSelectedMessages()}>{deleteBusy?"Удаляем…":"Удалить"}</Button><Button className="secondary-button" disabled={deleteBusy} onClick={()=>setBatchDeleting(null)}>Отмена</Button></div></Dialog>}
      {deleting&&<Dialog title="Удалить сообщение?" close={()=>{if(!deleteBusy)setDeleting(null);}}><p>Сообщение будет удалено у всех участников переписки.</p><div className="inline-actions"><Button type="button" className="primary-button" disabled={deleteBusy} onClick={()=>void removeMessage()}>{deleteBusy?"Удаляем…":"Удалить"}</Button><Button type="button" className="secondary-button" disabled={deleteBusy} onClick={()=>setDeleting(null)}>Отмена</Button></div></Dialog>}
      {emojiOpen&&selected&&section==="chats"&&<EmojiMenu userId={me.id} choose={chooseEmoji} close={()=>setEmojiOpen(false)}/>}
      {attachment&&<AttachmentUpload key={`${attachment.chatId}:${attachment.file.name}`} {...attachment} replyToId={context?.kind==="reply"?context.message.id:undefined} close={()=>setAttachment(null)} notify={notify} sent={async id=>{if(selectedRef.current===id){setContext(null);await refreshHistory(id);}await refreshLists();}}/>}
      {recordingKind && selected && <RecordingDialog key={`${selected}:${recordingKind}`} kind={recordingKind} activity={recording} chatId={selected} replyToId={context?.kind === "reply" ? context.message.id : undefined} notify={notify} close={() => setRecordingKind(null)} sent={async chatId => {
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
            initialKind="group"
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
              <Button key={e} onClick={() => void reaction(e)} aria-label={e}>
                {e}
              </Button>
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
      {modal === "forward" && forwardSources.length>0 && (
        <Dialog title={`Переслать сообщения · ${forwardSources.length}`} close={()=>setModal(null)}>
          <p>Выберите переписку</p>
          <div className="forward-destinations">
            <Button className="secondary-button" disabled={busy} onClick={()=>{setBusy(true);void ensureSaved().then(async chat=>{queueForwards(chat.id);await refreshLists();}).catch(notify).finally(()=>setBusy(false));}}><Icon name="bookmark"/>Избранное</Button>
            {chats.filter(c=>c.kind!=="saved").map(c=><Button className="secondary-button" key={c.id} onClick={()=>queueForwards(c.id)}>{c.name}</Button>)}
          </div>
        </Dialog>
      )}
      {modal === "group" && details && (
        <Dialog title="Участники и настройки" close={() => setModal(null)}>
          {(details.chat.owner_id === me.id || me.role === "admin") && (
            <>
              <Form
                className="group-settings-form"
                key={details.chat.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  void manage({
                    title: new FormData(e.currentTarget).get("title"),
                    description: new FormData(e.currentTarget).get("description"),
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
                <Field label="Описание"><textarea name="description" defaultValue={details.chat.description??""} maxLength={2000}/></Field>
                <Button className="primary-button">Сохранить</Button>
              </Form>
              <AvatarPicker
                chatId={details.chat.id}
                done={async () => {
                  await loadManagement(details.chat.id);
                  await refreshLists();
                }}
                notify={notify}
              />

            </>
          )}
          {details.chat.owner_id!==me.id && me.role!=="admin" && details.chat.description && <p className="group-description">{details.chat.description}</p>}
          {details.members.some(u=>u.id===me.id) && (
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
              </Field>)}
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
                    <Button
                      className="text-button"
                      onClick={() => void manage({ remove: u.id })}
                    >
                      Исключить
                    </Button>
                    {!u.banned && (
                      <Button
                        className="text-button"
                        onClick={() => void manage({ ownerId: u.id })}
                      >
                        Передать управление
                      </Button>
                    )}
                  </>
                )}
            </div>
          ))}
          {details.members.some((u) => u.id === me.id) && (
            <Button
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
            </Button>
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
            {systemGroups.map(group=><Button type="button" className="secondary-button" key={group.role} aria-pressed={systemRole===group.role} onClick={()=>{setSystemRole(group.role);setEditGroup(null);}}>{group.name}</Button>)}
            {groups.map((g) => (
              <Button
                className="secondary-button"
                key={g.id}
                onClick={() => {setSystemRole(null);setEditGroup(g);}}
              >
                {g.name}
              </Button>
            ))}
            <Button className="text-button" onClick={() => {setSystemRole(null);setEditGroup(null);}}>
              Новая группа
            </Button>
          </div>
          {systemRole ? <section aria-label="Системная группа">
            <h2>{systemGroups.find(group=>group.role===systemRole)?.name}</h2>
            <p className="field-note">Системная группа</p>
            <p>{systemGroups.find(group=>group.role===systemRole)?.description}</p>
            <p>Состав определяется ролью в карточке пользователя. Права системной группы заданы приложением.</p>
            <div className="people-options">{users.filter(user=>user.role===systemRole).map(user=><div key={user.id}>{user.name}{user.banned?" · Заблокирован":""}</div>)}</div>
            <Button type="button" className="secondary-button" onClick={()=>{setModal(null);void navigate({to:"/admin/users",search:{}});}}>Управление пользователями</Button>
          </section> : <MembershipForm
            key={editGroup?.id ?? "new"}
            group={editGroup}
            users={users}
            done={async () => {
              setGroups(await api("admin/groups"));
              setEditGroup(null);
            }}
            notify={notify}
          />}
        </Dialog>
      )}
    </div></MobileInteractions.Provider>
  );
}
