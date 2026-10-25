import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellOff,
  Compass,
  FolderOpen,
  Heart,
  Library,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings,
  UserRound,
  UsersRound,
} from "lucide-react";

const icons = {
  plus: Plus,
  users: UsersRound,
  chats: MessageCircle,
  profile: UserRound,
  settings: Settings,
  back: ArrowLeft,
  next: ArrowRight,
  refresh: RefreshCw,
  heart: Heart,
  menu: MoreHorizontal,
  bell: Bell,
  bellOff: BellOff,
  search: Search,
  materials: Library,
  navigator: Compass,
  storage: FolderOpen,
};

export function Icon({ name }: { name: keyof typeof icons }) {
  const Component = icons[name];
  return <Component size={20} strokeWidth={1.8} aria-hidden="true" />;
}
