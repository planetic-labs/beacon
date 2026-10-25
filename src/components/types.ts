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
  kind: "direct" | "group";
  name: string;
  title: string;
  ownerId: string;
  avatar?: string;
  preview?: string;
  lastAt?: string;
  unread: number;
};
export type Message = {
  type: string;
  id: string;
  chatId: string;
  authorId: string;
  authorName: string;
  authorImage?: string;
  clientMessageId: string;
  content: { text: string };
  createdAt: string;
  editedAt?: string;
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
  failed?: boolean;
};
export type Group = {
  id: string;
  name: string;
  code: string;
  members: string[];
};
