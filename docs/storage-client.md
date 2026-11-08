# Storage client data

Storage uses TanStack Query for spaces/capacity, folder listings with pagination,
file details, processing status, destination selection, groups and grants.
Mutation success invalidates the account's Storage queries. Tus byte transfer and
its progress controls remain independent from the request cache.

`storage-queries.ts` owns query keys and polling. Keys include account identity
and login generation. `AppQueryProvider` creates a new in-memory QueryClient for
each generation and clears the previous client. Responses from an old generation
are rejected by `storageApi`. The cache is not persisted into Dexie.

Queries consume AbortSignal, share requests for the same key, and retain their
own pagination state. Folder changes never reuse another folder's results.
Capacity refreshes every 30 seconds in the foreground; pending operations poll
every two seconds. Cached data is fresh for 15 seconds. Read errors retry once
except 4xx; mutations do not retry automatically.

React Hook Form manages Storage creation/settings forms, the file-card editor
and virtual playlists. Chapters belong to the file; secondary attachments have
been removed. Publication toggles and card/playlist saves invalidate the Materials
catalogue as well as Storage queries. UI components remain React Aria and
native inputs. Chat server state, drafts, Socket.IO and Dexie are unchanged;
their possible migration is tracked in TODO.md.
