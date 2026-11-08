# Upload integration API

The initial API creates new files only. It does not edit, overwrite, delete,
publish or create playlists. A JSON/VTT file containing timecodes is uploaded
like any other file; this version does not parse it into chapters automatically.
Structured metadata can be added later as a separate versioned resource referencing
the file UUID, without changing the byte-transfer protocol.

## Authentication and scope

Set `UPLOAD_INTEGRATIONS_JSON` in external deployment configuration. The default
`[]` disables integration access. Each entry has `id`, `tokenSha256` (SHA-256 of
the bearer secret, 64 lowercase hex digits), `userId`, `spaceId`, nullable
`parentId`, and `capabilities: ["files:create"]`. Keep the original secret only
in the uploading service. Use a dedicated unblocked Beacon account with write
access to the destination. The normal Storage interface remains admin-only.

All requests use `Authorization: Bearer <secret>` over HTTPS. The destination
comes from server configuration, never from the request. Changing the key hash
revokes the old key. Empty capabilities disable its operations. Authentication
and capability checks live in `modules/storage/integration-access.ts`.
`files:update` and `files:delete` are reserved capabilities: no corresponding
handlers exist, so enabling those strings does not enable destructive operations.
Future handlers must explicitly request their own capability.

Audit records bind each reserved file to its integration ID and user. A key
cannot resume or inspect another integration's uploads, even in the same folder
and under the same account. Renamed/moved files leave the configured upload
scope. Integration keys never authenticate to ordinary Storage/Materials routes.

## Protocol

1. `POST /api/integrations/v1/uploads` with `{ "name": "recording.mp4", "size": 12345 }`.
   Extra properties are rejected. The response is HTTP 201 with `id`, `state`,
   `uploadEndpoint` and `metadata: { "nodeId": "<UUID>" }`.
2. Start a tus 1.0 upload at the returned endpoint. Send the bearer header,
   `Tus-Resumable: 1.0.0`, `Upload-Length` and `Upload-Metadata: nodeId <Base64 UUID>`.
   Save the returned `Location` to resume after a process restart.
3. `HEAD Location` gets the offset; `PATCH Location` appends a chunk with
   `Content-Type: application/offset+octet-stream` and `Upload-Offset`.
   Standard tus clients handle this; chunks are not metadata edits.
4. `GET /api/integrations/v1/uploads/<id>` reports `uploading`, `processing`,
   `ready` or `error`. Only `ready` means the final file is available.

Existing names produce HTTP 409; completed files cannot receive more chunks.
Metadata edits, deletion and tus termination are rejected. Store the reservation
UUID and tus Location in the producer: retrying a creation request is not an
idempotent request and may return a name conflict. A separate source-id based
idempotency contract is not included in this version.

## Private documentation

`/api/docs/` serves Swagger UI, `/api/docs/json` the OpenAPI contract, and
`/api/docs/yaml` its YAML form. All documentation routes, including UI assets,
require a valid unblocked Beacon user session. A bearer integration key alone
does not grant documentation access. Responses are not publicly cached; the UI
does not persist entered keys and does not execute operations from its page.

The published contract currently covers only the integration upload API. Its
creation body is generated from the same Zod schema as the request handler.
