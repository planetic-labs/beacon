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
