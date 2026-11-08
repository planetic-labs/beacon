# Transcription boundary (planned)

The server-side provider contract is in `apps/api/src/modules/transcription/provider.ts`.
The Groq adapter uses `whisper-large-v3-turbo` by default. Set
`TRANSCRIPTION_PROVIDER=groq` and `GROQ_API_KEY` in external server configuration;
`GROQ_TRANSCRIPTION_MODEL` optionally selects another compatible transcription model.
No keys are sent to the browser or stored in the repository.

The request path is: browser recording → authenticated Beacon API → server-side
transcription service → selected provider → text returned to the browser draft.
Providers may wrap a third-party HTTP API or a separately deployed local container.
The browser must not know the provider URL, credentials or provider-specific payload.
Replacing a provider must not require changing the recording interface.

The provider accepts validated audio bytes, MIME type and an optional language hint;
it returns text and an optional detected language. Cancellation and server timeouts
are propagated through AbortSignal. `POST /api/transcriptions` accepts multipart `chatId` and `file`, and returns
`{text}`. It requires a logged-in chat member and same-origin requests. No message
is created by this endpoint. The client Stop action inserts the result into a
text draft; the Send arrow still sends an audio message.

Beacon authenticates the caller, checks chat membership, normalizes and validates
the recording through the existing media processor, and removes temporary files.
There are at most two active transcriptions per API instance, one per user, and
six starts per minute per user. These limits are process-local; multiple API
instances must replace them with a shared limiter. Groq calls have a 90-second
timeout; a disconnected client aborts the upstream call. Existing messages are
not supported as transcription sources. Provider credentials stay in external server
configuration. Audio, transcript and credentials must not be included in logs.
Transcribing a recording must not automatically send a message: the result is a
user-editable draft. Audio is sent to Groq only after the user requests transcription. Beacon does not
persist transcription recordings or results. Groq retention is governed by the
provider account settings and policies. On failure the browser retains its local
recording for retry or audio sending.

Live waveform rendering is independent of transcription and runs in the browser.
The waveform uses a local canvas component and browser audio analysis.
