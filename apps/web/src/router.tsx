import { createRootRoute, createRoute, createRouter, Outlet, Link, redirect } from "@tanstack/react-router";
import { Beacon } from "./components/beacon";
import Consent from "./consent";

const root = createRootRoute({
  component: Outlet,
  validateSearch: (search: Record<string, unknown>) : { chat?: string; [key: string]: unknown } => ({
    ...search,
    chat: typeof search.chat === "string" && /^[0-9a-f-]{36}$/i.test(search.chat) ? search.chat : undefined,
  }),
  notFoundComponent: () => <main className="auth-shell"><section className="auth-card">
    <h1>Страница не найдена</h1><Link to="/">Вернуться к чатам</Link>
  </section></main>,
});
const app = createRoute({ getParentRoute: () => root, id: "app", component: Beacon });
const index = createRoute({ getParentRoute: () => app, path: "/" });
const chat = createRoute({ getParentRoute: () => app, path: "/chats/$chatId" });
const materials = createRoute({ getParentRoute: () => app, path: "/materials" });
const storage = createRoute({ getParentRoute: () => app, path: "/storage" });
const people = createRoute({ getParentRoute: () => app, path: "/people", beforeLoad: () => { throw redirect({ to: "/", replace: true }); } });
const profile = createRoute({ getParentRoute: () => app, path: "/profile", beforeLoad: () => { throw redirect({ to: "/settings/profile", replace: true }); } });
const settings = createRoute({ getParentRoute: () => app, path: "/settings" });
const settingsProfile = createRoute({ getParentRoute: () => app, path: "/settings/profile" });
const settingsSecurity = createRoute({ getParentRoute: () => app, path: "/settings/security" });
const settingsNotifications = createRoute({ getParentRoute: () => app, path: "/settings/notifications" });
const settingsStickers = createRoute({ getParentRoute: () => app, path: "/settings/stickers" });
const settingsData = createRoute({ getParentRoute: () => app, path: "/settings/data" });
const settingsAbout = createRoute({ getParentRoute: () => app, path: "/settings/about" });
const admin = createRoute({ getParentRoute: () => app, path: "/admin" });
const adminStickers = createRoute({ getParentRoute: () => app, path: "/admin/stickers" });
const adminUsers = createRoute({ getParentRoute: () => app, path: "/admin/users" });
const adminGroups = createRoute({ getParentRoute: () => app, path: "/admin/groups" });
const adminStorage = createRoute({ getParentRoute: () => app, path: "/admin/storage" });
const adminChats = createRoute({ getParentRoute: () => app, path: "/admin/chats" });
const consent = createRoute({ getParentRoute: () => root, path: "/consent", component: Consent });
export const router = createRouter({
  routeTree: root.addChildren([app.addChildren([index, chat, materials, storage, people, profile, settings, settingsProfile, settingsSecurity, settingsNotifications, settingsStickers, settingsData, settingsAbout, admin, adminStickers, adminUsers, adminGroups, adminChats, adminStorage]), consent]),
  defaultPreload: "intent",
});
declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
