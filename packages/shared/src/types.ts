import type { Mention } from "./chat-features";
export type User = {
  groups?: { id: string; name: string; code: string }[];
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email?: string;
  image?: string;
  role?: string;
  banned: boolean;
};
export type Chat = {
  id: string;
  kind: "direct" | "group" | "saved";
  peerId?: string;
  pinned?: boolean;
  description?: string;
  name: string;
  title: string;
  ownerId: string;
  avatar?: string;
  preview?: string;
  lastAt?: string;
  unread: number;
  lastUnreadMessageId?: string | null;
  unreadMentions?: number;
  lastMessageId?: string;
};
export type Message = {
  type: string;
  id: string;
  chatId: string;
  authorId: string;
  authorName: string;
  authorImage?: string;
  clientMessageId: string;
  content: { text: string; mentions?: Mention[]; fileId?: string; name?: string; size?: number; mime?: string; fileIds?: string[]; stickerId?: string; duration?: number };
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
  pinned?: boolean;
  replyToId?: string;
  reply?: { id: string; text: string; authorName: string };
  forwardedFrom?: { authorName: string };
  reactions: { userId: string; name: string; emoji: string }[];
};
export type Pending = {
  chatId: string;
  clientMessageId: string;
  text: string;
  replyToId?: string;
  forwardId?: string;
  forwards?: {forwardId:string;clientMessageId:string}[];
  stickerId?: string;
  mentions?: Mention[];
  failed?: boolean;
};
export type Group = {
  id: string;
  name: string;
  code: string;
  members: string[];
};

export type Sticker = { id: string; fileId: string; label: string; emojis?: string[]; keywords?: string[] };
export type StickerPack = { ownerId?: string | null; ownerName?: string | null; id: string; name: string; active: boolean; stickers: Sticker[] };

export type Pin = { id:string; authorName:string; text:string; type:string; pinnedBy:string; pinnedAt:string };
export type PinPage = { pins:Pin[]; total:number; next?:{id:string;at:string} };
export type Presence = { userId:string; online:boolean; lastSeenAt:string|null };

export type OfflineSnapshot = {messages:Message[];hasMoreRead:boolean;hasMoreUnread:boolean;unreadStartId?:string};
