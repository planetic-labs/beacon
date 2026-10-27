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

TanStack Router owns `/`, `/chats/$chatId`, `/people`, `/settings`, `/settings/profile`, `/settings/security`, `/settings/notifications`, `/settings/about`, `/admin` and
`/consent`. Legacy `/profile` links redirect to `/settings/profile`. Settings reuse the administration three-column shell with a separate section list available to every user; mobile navigation switches between that list and its selected page. The app layout stays mounted during section navigation, retaining
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

### Stickers

Sticker packs are managed by administrators through `/api/stickers` and the dedicated `/admin/stickers` screen, selected from the administration sidebar. Administration uses a three-column desktop layout (global navigation, section navigation, content); mobile navigation switches between the section list and its content. User administration, membership groups and group chats have their own `/admin/users`, `/admin/groups` and `/admin/chats` routes. PNG/JPEG/WebP originals accept up to ten files of 10 MiB each. Sharp validates and decodes images (up to 16 megapixels), applies orientation, preserves transparency and aspect ratio, fits them within 512 × 512 without enlargement, strips metadata, and stores only WebP output through the existing private storage adapter. Animated sources are rejected until animated stickers are supported. Pack metadata and sticker records live in `sticker_pack` and `sticker`. Disabling a pack hides it from regular users' selection and prevents new sends. Existing messages and forwards retain their file references and remain readable. Administrators can rename packs and remove individual stickers from a pack. Removing a sticker deletes its catalog entry, prevents new sends, and keeps its media for historical messages; access to that media then requires membership of a chat containing it. Authenticated users can read sticker assets because packs form a shared application catalog.

A `sticker` message stores a server-resolved sticker ID, media ID and label. Clients cannot replace the label or media reference, and sticker messages cannot be edited. Replies, reactions, forwarding and delivery reuse the message service. Recent selections are stored per account in the browser, capped at 24 entries and filtered against currently enabled packs. The targeted UI check is `pnpm exec tsx tests/browser-stickers.ts` inside the browser test image; it uses synthetic API data at desktop and mobile widths.


Sticker metadata includes an editable label, up to twelve Unicode emoji sequences and thirty-two normalized keywords. Emoji recognition follows the Unicode data in `emoji-regex`; matching ignores only presentation selectors, retaining ZWJ sequences, flags and skin-tone modifiers. Metadata edits never rewrite existing messages. Fuse.js searches the active catalog locally, preferring exact matches and then recent usage for equal-ranked results. Composer suggestions inspect the trailing word or complete emoji, without sending draft text to an API.

Catalog metadata is loaded on demand and persisted per account in browser storage. A content-derived ETag allows conditional refreshes without downloading an unchanged catalog. Opening the picker, returning focus, or changing stickers in the admin interface revalidates it; typing does not issue a request per keystroke. Cached metadata is validated before reuse. Images remain outside this metadata cache and load on demand. Suggestions offer enlarged hover/focus previews and a touch-hold preview. Selecting a suggestion removes only its trailing trigger, preserving the rest of the draft.


### Voice messages and video circles

Recording uses native `getUserMedia` and `MediaRecorder` with format capability detection, explicit device permissions, a timer, preview, cancellation and retry. Voice messages are limited to five minutes and 10 MiB source files; video circles to one minute and 25 MiB. Devices stop after recording, on cancellation/unmount, and when the page becomes hidden. Upload retries retain their client message UUID. Existing text drafts are retained when sending a recording.

`/api/recordings` authenticates the sender, checks chat membership and normalizes uploaded recordings through the replaceable media processor adapter. FFmpeg/ffprobe run without a shell, with forced input demuxers, restricted protocols, bounded file size, dimensions, duration, processing time, threads and concurrency. Only normalized AAC/MP4 output enters the existing private storage adapter. Video is center-cropped to a 512-pixel square and rendered as a circle. Temporary originals are removed. This short-recording adapter can later be moved to an external worker without changing message delivery.

The `audio` and `circle` message types share replies, reactions, forwarding and idempotent delivery. Editing is limited to text/photo messages. Authorized media delivery supports single HTTP byte ranges for playback and seeking; every request still checks current membership. Media remains excluded from public PWA caches. Browser recording checks run against fake camera/microphone devices and synthetic users, and also verify playback of the normalized AAC/MP4 output.

## Search, acknowledgements and activity

`modules/search` exposes a `SearchProvider` boundary. The initial PostgreSQL provider uses an indexed `simple` full-text vector for text and photo captions. Queries require two characters, normalize case and Cyrillic ё/е, combine words with AND and match word prefixes. Values are parameterized; user input is never interpreted as SQL or raw tsquery syntax. People and chat names are separate result sections. Filters apply to message authors and inclusive UTC calendar dates. Message pagination uses the `(created_at, id)` tuple. Each query restricts messages to current chat membership, including for administrators. Another provider must preserve that authorization contract. There is no indexing of media contents or speech.

An authorized `aroundId` history request loads a bounded window around a search/reply target. While viewing an older window, reconciliation refreshes only that window; “К новым сообщениям” returns to live history. This avoids downloading all intervening years merely to open one old result.

A message is sent after the server commits it. Delivery means an authenticated recipient application acknowledged its chat envelope; a successful push-gateway response alone never marks delivery. One device is sufficient. Read acknowledgement advances only when a message intersects the visible feed in a foreground document. Both are monotonic per-member cursors, with full PostgreSQL microsecond precision; repeated acknowledgements produce no event. Read implies delivered. Group UI shows partial counts, considering current members who had joined when the message was sent. These cursors describe account-level state, not a durable per-device/per-recipient historical receipt ledger. Receipt access requires current membership even for administrators.

Typing/audio/video activity is ephemeral and authenticated through Socket.IO. Membership is rechecked when publishing. A small `publishActivity` transport boundary uses PostgreSQL NOTIFY to fan out between realtime instances; it can later use Redis without changing message storage or UI events. Activity is volatile, source-device scoped, throttled, refreshed while active and expires after 6.5 seconds. Stopping, hiding the page, switching chats and disconnecting clear it; the TTL covers dropped stop packets. Activity never enters durable message history or the outbox.

Mentions use a bounded structured list of `{ userId, start, length }` in text/photo content. Positions are UTF-16 textarea offsets, not ad-hoc usernames or email addresses. Autocomplete uses chat participants. Server validation checks membership, canonical displayed names, bounds and non-overlap, including after text trimming. Editing through a mention removes its identity metadata. Existing forwarded mentions retain their display but do not create a new unread-mention badge. An unread `@` badge and highlighted self-mentions distinguish direct addresses. Existing push privacy and mute preferences remain in force.

## File attachments and message deletion

Documents/archives are limited to 100 MiB, video files to 500 MiB, one attachment per message. An encapsulated `@fastify/multipart` route authenticates before parsing, requires metadata before the file stream and applies bounded fields/parts/file sizes, upload concurrency and time limits. Upload and private HTTP range delivery stream through the storage adapter with backpressure. The Fetch/Fastify bridge streams response bodies rather than accumulating large videos. Browser upload has progress, cancellation and a stable client UUID for retries. Captions are optional; existing text drafts are retained. There is no video transcoding: MP4/WebM containers may play in the browser; other formats remain downloads.

Original names are display metadata only and never become filesystem paths. Documents/archives use `application/octet-stream` with attachment disposition, no-sniff and a sandbox CSP. Video downloads retain a download link. Every full/range request rechecks current access; private attachments are excluded from public browser caches.

Authors can delete their own messages for all participants, with one confirmation and no per-user deletion mode. Administrative chat management does not grant this permission. The payload, reactions, reply/forward metadata and pending push jobs are cleared; a minimal deleted marker retains message/client IDs and cursor position. This prevents retry resurrection and allows offline/reconnecting clients to reconcile. Deleted messages are excluded from unread counts, previews, search and forwarding. A quote referring to a deleted message resolves to the deleted marker.

A forward creates an independent message referencing the same media IDs, not a physical copy. File authorization disappears as soon as its last accessible message is deleted. Durable cleanup jobs unlink files only after checking all remaining live message, avatar, chat image and sticker references. Forward reads lock the source message so concurrent deletion cannot remove a file while a forward is being committed. Cleanup is idempotent, runs independently from chat-event dispatch and retries after storage failures. Existing backups and bytes already downloaded by recipients are outside this application-level deletion mechanism.

## Saved messages, pins, presence and batch forwarding

A lazily created `saved` chat has one member and a stable unique `saved:<user UUID>` key. Concurrent creation is serialized like direct chats. Only its owner can open it; administration does not grant access. The existing message types, attachments, search, editing/deletion and pins work unchanged. The UI keeps Saved Messages at the top and hides recipient-delivery badges for notes addressed to oneself.

Any current participant can pin/unpin a live message in direct/group chats; group administrators outside the chat have no extra pin access. Pins are stored separately with their author/time, exposed through membership-checked cursor pagination and linked from a compact conversation strip. History includes pin state. Deleting a message removes its pin in the same transaction; membership removal immediately revokes pin access.

Batch forwarding accepts up to 100 unique source messages and unique per-message client UUIDs. The server verifies all sources and destination membership, locks the sources and commits the copies atomically in original `(created_at,id)` order. One unavailable source rolls back the batch. A completed replay is idempotent even if an original was subsequently deleted. Copies reuse the existing file IDs. One chat event reconciles the whole batch rather than broadcasting one event per copied item. The existing account-scoped pending queue persists the batch and its UUIDs for offline/retry behavior.

Presence means a visible, authenticated application, not merely a saved login. A heartbeat uses per-connection PostgreSQL leases, session foreign keys and a 75-second expiry, with updates every 25 seconds. Foreground/hidden changes, disconnects and an authenticated page-hide beacon update aggregate account presence; another visible tab/device keeps it online. Server time and per-user serialization prevent inconsistent transitions. Presence transitions fan out through the existing PostgreSQL event transport; unchanged heartbeats do not broadcast. Periodic reconciliation covers lost events and instance crashes. Last observed visits are stored separately on the user. Presence responses contain user IDs, online state and last-visit timestamps, never sessions, addresses or emails. A transport/storage adapter can replace these leases with Redis later.

## Photo viewing, chat attachment library and read details

Photo messages open an in-app viewer rather than a new browser tab. The viewer uses membership-checked album metadata, supports ordered navigation within albums and adjacent photo messages, zoom/pan, touch pinch/swipe, keyboard arrows and downloading originals. Navigation stays bounded: metadata for one album plus adjacent message IDs, not the whole photo history. Message changes/reconnection revalidate the open album. Deleted or inaccessible albums lose their visible payload.

The conversation title opens a paginated attachment library with Photo, Video (including circles), Files, Links and Audio tabs and a jump back to the source message. Queries use stable `(created_at,id)` cursors, current membership checks and partial attachment/link indexes. Web links are extracted locally from stored message text/captions, allow only explicit credential-free HTTP(S) URLs and never fetch external preview services. All library items and downloaded originals remain private.

Photo grids request 320-pixel WebP derivatives. Sharp processing is bounded by input pixels, time and concurrency; a small process-local LRU and shared in-flight requests avoid repeat work. Cache lookup always follows fresh media authorization; removal of the last accessible reference blocks even an already-cached derivative. HTTP/PWA caching remains disabled for private media. Full-resolution originals are requested only by the photo viewer or download. Shared dialogs support a modal stack so Escape closes only the top viewer and returns focus to the attachment library.

Authors can open per-message read details from the delivery badge or “Кто прочитал”. Access requires current membership and authorship. Results list current recipients who belonged to the chat at send time, grouped as read, delivered or not yet delivered. Exact times are first server acknowledgements, not device clocks or estimates of attention. Existing cursor-only acknowledgements retain known status with null/unknown times; there is no fabricated backfill.

A `receipt_checkpoint` stores each advancing delivery/read cursor as a non-overlapping `(from_at,through_at]` range, membership generation and server acknowledgement time. One acknowledgement covers any number of messages; repeats/older cursors insert no rows, later reads never overwrite prior times, and rejoining starts a new generation. An indexed lookup finds the first checkpoint ending at/after the message, then checks its range start, making unknown legacy times cheap too. The cursor and checkpoints commit with one receipt event. The read-details dialog refreshes over the existing receipt channel. This is account-level receipt history, not per-device tracking.


## Private chat preferences and drafts

A group's description is editable by its owner and administrators, limited to 2000 characters. Any current participant may add an active user; this grants no permission to rename the group, change its owner, remove members or change its image. Mixed privileged updates cannot bypass those checks.

Chat pins live on `chat_member` and affect only that account's list ordering (pins first, then last message time). An empty pinned direct chat appears once, rather than also appearing among unstarted conversations. Saved messages keep their dedicated first row. The existing per-chat push mute toggle remains a simple on/off preference.

Drafts also belong to membership and contain text plus structured mentions, never uploads. Private GET/PATCH endpoints recheck membership; optimistic integer revisions reject stale updates. A debounced browser adapter retains unsaved local edits during disconnects, retries conflicts against the newest revision and notifies only that account's sessions through `draft.changed`. Clean devices accept the newest server copy; simultaneous active edits use the last accepted local save, without collaborative text merging. Reconnection and visibility reconcile missed events. Unsynced edits use account-scoped session storage for reload recovery; explicit sign-out clears that backup. Editing a sent message does not replace the regular draft. Clearing the composer after queueing a message syncs an empty draft; the outgoing queue retains its own recovery data. Removing membership removes its draft and pin with it.


## Emoji composer picker

The composer opens a standalone emoji-picker-react panel, with Russian search/data, categories, skin tones and account-scoped local recent selections. Desktop uses a floating panel and mobile a bottom sheet. Emoji selection inserts standard Unicode at the saved textarea selection, replacing selected text and retaining the insertion position for consecutive picks; it never submits the message. The existing mention-offset and draft logic handles the edit. The picker and its bundled dataset load on opening; native glyphs avoid external image/CDN requests. Import failures have a local retry state. The existing dialog handles focus and dismissal, with Escape captured before the picker consumes it. No server or database changes are required.


Settings keep profile editing, passkey management, push preferences and application information on separate routes. The last settings item, About, shows the root package version injected by Vite, the production shell build identifier, build time and mode. Development shows its frontend startup time. Users can copy these public details and check the existing service-worker registration for updates; activation continues through the draft-safe update banner.

Passkey registration preserves Better Auth's fresh-session requirement. An explicit `SESSION_NOT_FRESH` response opens email confirmation for the current account. The standard sign-in OTP endpoint creates a fresh session without a manual sign-out. A separate Continue button starts WebAuthn after confirmation to retain a user gesture; cancellation leaves the app open. Other authorization failures do not trigger this flow. Registration options use native fetch for Safari compatibility; verification remains on the authentication library's server endpoints.

The administration group list includes the built-in Administrator and User roles alongside additional membership groups. System groups derive their members from user roles, explain their fixed privileges and link to user management for role assignment. They are not editable membership-group records and do not change integration group claims.
