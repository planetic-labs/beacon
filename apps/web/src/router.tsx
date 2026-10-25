import { createRootRoute, createRoute, createRouter, Outlet, Link } from "@tanstack/react-router";
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
const people = createRoute({ getParentRoute: () => app, path: "/people" });
const profile = createRoute({ getParentRoute: () => app, path: "/profile" });
const admin = createRoute({ getParentRoute: () => app, path: "/admin" });
const consent = createRoute({ getParentRoute: () => root, path: "/consent", component: Consent });
export const router = createRouter({
  routeTree: root.addChildren([app.addChildren([index, chat, people, profile, admin]), consent]),
  defaultPreload: "intent",
});
declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
