# Personal calls

Beacon owns invitations, chat membership, busy state, acceptance, rejection and
hangup. LiveKit owns the WebRTC room and media. Calls and participants have
separate PostgreSQL tables; group creation is deliberately rejected for now.
Future group calls can reuse participant authorization and room lifecycle.

Mobile personal chats expose audio/video actions inside the header menu. Desktop
personal chats show the actions in the header. Incoming invitations are global
to the authenticated application, including while another section is open.
Call invitations also use the existing Web Push subscription when notifications
are enabled. A high-priority push can notify a background/closed PWA. Tapping it
opens Beacon; the user then accepts inside the application. This is a browser
notification, not native OS telephony: continuous ringing, full-screen system call
UI and guaranteed delivery under OS battery restrictions are separate work.

The call dialog supports acceptance, rejection, cancel, hangup, microphone mute
and camera toggle. Browser permissions and HTTPS are required. A separate sound
button handles browsers that require another gesture to permit audio playback.
LiveKit's client is loaded only when a conversation is accepted.

## Devices and background invitations

Every loaded application instance generates its own random client UUID in memory
(no hardware fingerprint and no localStorage shared across tabs). The caller is
bound at creation; the callee is claimed atomically on first acceptance. Other
caller instances receive no call window. All callee instances see an unanswered
invitation, but only the winning instance can get media credentials, heartbeat
or end the accepted call. There is no status banner on the other devices. Reload
creates a new instance; automatic transfer/recovery of an active call is not
implemented. Old instances time out normally.

Call requests use `X-Beacon-Call-Client`, validated as UUID by the API. The
instance ID supplements normal authenticated-user and membership checks; it is
not a replacement for authentication.

`call_push_delivery` queues opaque identifiers only. Delivery rechecks sessions,
blocking, membership, mute/notification preferences and the 60-second invitation
window. The gateway gets high urgency and a 60-second TTL. The service worker
fetches the current authorized invitation before showing it, and again when a
user taps it. Acceptance, decline, hangup and timeout enqueue a state update to
close existing notifications on the callee's devices. Focused app windows receive
an in-app update instead of a duplicate OS notification. Notification dismissal
alone does not reject a call on the other devices. Delayed/lost state pushes may
leave an OS notification until tapped, but cannot join an expired call.

## Authorization and lifecycle

`GET /api/v1/calls` returns only the actor's active invitation/conversation.
`POST /api/v1/calls` accepts `chatId` and `mode` (`audio` or `video`). Actions on
`/api/v1/calls/:id/{accept,decline,end,join,heartbeat}` are authenticated POSTs
with the normal origin and account checks. An unrelated administrator has no
special access. One active call per participant is enforced transactionally.

Only an accepted call issues a 60-second, room-scoped token with the user's UUID
as identity. Audio calls may publish only microphone tracks; video calls may
also publish the camera. Rooms are created explicitly with two participants.
Set `room.auto_create: false` in LiveKit so a stale token cannot recreate a room
after hangup. No recording service or SIP service is deployed.

Unanswered calls expire after 60 seconds. Active clients heartbeat every 10
seconds; a missing participant heartbeat for 45 seconds ends the conversation.
Blocking or removing a chat participant also ends the call. The realtime worker
expires abandoned calls and deletes ended LiveKit rooms via a durable outbox job.
Room cleanup retries if LiveKit is temporarily unavailable. Socket.IO sends
private invalidations; a periodic HTTP reconciliation covers reconnects.

## Deployment

Append `docker-compose.calls.yml` to the environment's **complete** COMPOSE_FILE
list, preserving all existing storage overrides. It adds LiveKit to that
deployment's private network. Each dev/preview/production copy needs independent
keys, room prefix, configuration and host ports. The optional file is not needed
when calls are disabled. See `.env.example` for the variables.

- `LIVEKIT_URL`: public WSS endpoint, for example `wss://calls.example.com`.
- `LIVEKIT_INTERNAL_URL`: internal control API, normally `http://livekit:7880`.
- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`: unique server credentials.
- `LIVEKIT_ROOM_PREFIX`: deployment-specific namespace.
- `LIVEKIT_CONFIG_FILE`: external YAML file, readable only by its owner.
- `CALL_API_PORT` / `CALL_TURN_PORT`: loopback ports for Caddy.
- `CALL_RTC_TCP_PORT` / `CALL_RTC_UDP_PORT`: direct, encrypted WebRTC ports.

The media ports are an intentional exception to HTTP-only loopback publication:
ICE/TCP and ICE/UDP need direct client connectivity. They are not database/API
ports. Reserve them in the infrastructure registry, check occupancy and firewall
reachability, and configure identical ports in LiveKit's `rtc.tcp_port` and
`rtc.udp_port`. Do not translate them to different external port numbers.

The external LiveKit configuration must contain the API key pair, the correct
public node address (or validated STUN discovery), room auto-creation disabled,
and the two RTC media ports. Keep real keys, domains and node addresses outside
the Beacon repository.

Existing Caddy with `caddy-l4` can route WSS signalling by domain to the loopback
API port and terminate TURN TLS on external TCP 443. Configure LiveKit TURN with
`enabled: true`, `tls_port: 443`, `external_tls: true` and its dedicated domain.
Caddy forwards the decrypted connection to the loopback TURN port. Pass PROXY
protocol v2 and enable LiveKit's `turn.proxy_protocol` with the exact trusted
proxy/Docker gateway CIDR so browsers receive the client's mapped address.
Caddy must manage a trusted certificate for each domain. Plain HTTP
`reverse_proxy` is sufficient for signalling but not for the TURN TCP stream.

## Verification

All commands run in Docker. `tests/calls-integration.ts` requires a disposable
PostgreSQL database and implements a synthetic LiveKit control API. It verifies
membership, group rejection, multi-device ownership, concurrent busy/answer state, token grants, cleanup,
timeouts and blocking. `tests/browser-calls-ui.ts` covers desktop/mobile menu
placement and incoming/outgoing invitations with synthetic API responses.

`tests/browser-calls.ts` is an explicit media integration check, not a default CI
test against deployment infrastructure. It requires disposable Beacon data and
`tests/calls-browser-setup.ts` fixtures in `/run/test/calls.json`. Supply an
authorized LiveKit test endpoint/key and a separate room prefix. The test forces
native browser RTC through TURN/TLS, uses fake capture devices, checks both
directions of audio/video and ends each call. It never uses existing user data.

`tests/call-push-integration.ts` verifies queue privacy, authorization, expiry and
first-answer ownership with a fake gateway. Service-worker tests include a closed
PWA, stale clicks, foreground suppression and notification cancellation.
