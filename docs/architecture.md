# Application structure

Beacon is a pnpm workspace running exclusively in Docker with Node.js 26.

- `apps/web`: React, Vite and TanStack Router. It owns the interface, styles,
  browser authentication client, service worker and public assets.
- `apps/api`: Fastify, Better Auth, chat and push policies, PostgreSQL/Drizzle
  access and file storage. The HTTP controllers use the standard Fetch API;
  Fastify adapts requests and responses, preserving separate Set-Cookie headers.
- `packages/shared`: shared API types and message schemas. Never import database
  code, server configuration or credentials into this package.
- `scripts/realtime.ts`: the separate Socket.IO and notification dispatcher.
- `drizzle`: existing database migrations and snapshots; framework migration
  does not change the database or the authentication issuer.

The existing external Caddy sends `/socket.io/*` to the realtime port and other
requests to Fastify. Independent deployments keep the existing APP_ENV naming,
loopback ports, volumes and external configuration. No extra proxy is deployed.

In development, Fastify mounts Vite middleware on its HTTP server, including HMR.
In production, it serves the Vite build. API and private media never use SPA
fallback. Vite's file access is restricted to the web app, shared package and
installed dependencies. The client build has no server environment variables.

TanStack Router owns `/`, `/chats/$chatId`, `/people`, `/profile`, `/admin` and
`/consent`. The app layout stays mounted during section navigation, retaining
drafts and the socket connection. Existing `/?chat=...` notification links remain
supported. OAuth login query parameters are preserved until authentication.
Existing UI styling and markup are carried over from the supplied design.

Production: `pnpm build` checks all packages and builds the web app; `pnpm start`
runs Fastify. Development: `pnpm dev`. Execute every command inside Docker.
`sh scripts/ci.sh` orchestrates disposable Docker services for type checks,
audit, HTTP integration, browser navigation, passkey, Socket.IO and push tests.
Test configuration and fixture sessions never use deployment credentials.

## Offline application shell and updates

`pnpm build` generates a unique shell version and injects a public-asset allowlist
into `dist/sw.js`. The HTML, built JS/CSS, icons and manifest are precached as one
release. Source `public/sw.js` has no shell manifest, so development retains
normal Vite caching and HMR. Use the same production build and `pnpm start` for
preview and production; no deployment-domain or secret values enter the build.
Each deployment must have its own origin, as required for independent cookies,
service workers and browser caches.

Only known application navigations receive the cached generic HTML shell.
Authentication, APIs, user media, discovery endpoints and non-GET requests are
never stored in Cache Storage or replaced by that shell. Offline shell startup
does not grant access to messages or restore an expired session. The next online
API request still checks the session and permissions.

An incomplete precache installation is discarded. A complete new version waits
until the user chooses Update or all old tabs close. The update button preserves
message drafts in account-scoped session storage for this tab and restores them
once after reload; it blocks updating during an edit, active mutation or storage
failure that would lose a draft. Other tabs are not reloaded. Old release caches
remain available until all open pages report that they run the current release.
Push subscriptions and the existing push-access checks use the same worker.

`tests/browser-pwa.ts` builds two releases and checks real Chromium service-worker
installation, offline reload, API/media isolation, failed installation, explicit
update, draft restoration, multiple tabs and cache cleanup against a disposable
static server with synthetic API data. It needs no database or deployment secrets.
