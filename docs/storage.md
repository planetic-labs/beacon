# Files in Beacon

The Files section uses Beacon sessions, user UUIDs and membership groups. It has no
separate authentication database. Administrators cannot open another user's personal
space; shared-space administration is separate from access to private messages.

The Files section is temporarily available only to the built-in Administrators role,
including direct routes, downloads and resumable upload endpoints. Folder/group grants
remain stored for future rollout but do not override this section-wide restriction.

## First implementation

- Storages are defined only by `STORAGES_JSON`. Administrators grant existing membership
  groups read or write access to configured shared storages or their folders.
  A configured personal storage creates each user's catalog on first opening Files.
- Grants inherit downwards. A grant on a nested folder permits traversal to it but
  does not expose files in neighbouring folders. There are no deny overrides.
- Folders and files have stable UUIDv7 identifiers. Names, hierarchy, permissions,
  favorites, visits, trash state and audit records are stored in PostgreSQL.
- The mounted filesystem is the source of file names and hierarchy. Opening or refreshing
  a directory discovers existing files and external changes. Rename, move, create-folder,
  trash and restore also change the actual filesystem. Copy creates a distinct file
  asynchronously; sharing one object with chat messages
  is intentionally deferred until retention/access semantics are agreed.
- Downloads use authenticated routes with Range support. Common image, audio, video,
  PDF and bounded text previews use browser capabilities. Other formats are downloads.
- Search filters the current list. It is not a recursive content search.
- Files/folders can be moved to trash, restored, or permanently removed. Removing a
  storage item does not delete users or chat messages.

## Files and configuration

The common file interface is `modules/files/storage.ts`; chat preserves its UUID object
keys and layout. The file manager implements that interface in `storage/filesystem.ts`,
resolving catalog IDs to real relative paths. Permissions and catalog remain independent.

Storage definitions are supplied through `STORAGES_JSON` in the external environment
configuration, following the standalone Storage Space convention. Example:

```dotenv
STORAGES_JSON='[{"id":"home","name":"Домашнее","path":"/data/personal","mode":"local","personal_parent":"users"},{"id":"team","name":"Командное","path":"/data/team","mode":"sshfs"}]'
```

`id` is a stable integration code, not a filesystem path or the catalog UUID. Keep it
unchanged when renaming a storage. Its PostgreSQL catalog UUID and grants survive
renames, restarts and disabling/re-enabling the same definition. Do not reuse an old
ID for a different disk. Removing an entry disables API access and background filesystem
operations without deleting the catalog or bytes. An explicit `[]` disables all storages.
Creation through POST `/api/storage/spaces` is rejected, including for administrators.
Paths and mount configuration are never returned to clients.

`path` is an absolute **container** path. Bind mounts and host paths belong in an external
Compose override. Shared roots must exist. SSHFS mode additionally checks that the
configured container mount is backed by `fuse.sshfs`; it never falls back to a local
folder when the mount is absent. Mount lifecycle and write protection are the host's
responsibility. Changing a path does not move files to the new path.

`personal_parent` makes a definition personal: every user sees their own virtual root
under `<path>/<personal_parent>/user-<Beacon UUID>`. This first version supports one
personal storage definition, plus any number of shared storages. Without STORAGES_JSON,
the default definition is Домашнее under STORAGE_ROOT (default `storage` below
MEDIA_ROOT), with `personal_parent=users`. Existing Compose deployments persist it in
their media volume. With explicit storage definitions, STORAGE_ROOT does not receive
upload bytes; each target space has its own hidden staging directory.

Files keep their real names and folder hierarchy on disk. The catalog stores their
UUIDs and relative paths; filesystem paths are not returned to the client. Each opened
directory is reconciled with disk, without scanning an entire remote volume on startup.
External disappearance hides stale entries; size/mtime changes invalidate hashes.
Renames made through Beacon retain IDs. External renames are discovered as different
paths and may receive new IDs. Hidden entries, temporary files and symlinks are excluded.
Copying a directory discovers its subtree first, including unopened nested folders.
Trash uses the hidden `.beacon-trash` directory on the same filesystem.

Personal folders always use `user-<Beacon UUID>`. There are no aliases, numeric-ID
compatibility mappings or runtime dependencies on the standalone application.
Configuring shared roots that contain personal folders also makes those trees available
through shared-root permissions; choose root boundaries accordingly.
All HTTP/worker instances of one deployment must see the same definitions, mounted
roots and staging directory. Environments require independent databases and volumes.
Never commit actual deployment paths or working environment files.

## Uploads and jobs

`@tus/server`, `@tus/file-store` and `tus-js-client` implement resumable uploads.
The client sends chunks up to 8 MiB, retries temporary errors, and saves a fingerprint
scoped to the space and destination folder. After a reload, select the same source
file again to resume; a browser cannot silently reopen a local file without permission.
The per-file maximum is 1 TiB (1024⁴ bytes), independent of chat attachment limits.
Uploads remain chunked at 8 MiB; reserving a large upload does not preallocate its size.
Folder input preserves nested paths; empty directories are not supplied by the browser.

Every upload request checks the current session, creator and destination permissions.
PostgreSQL advisory locks serialize concurrent changes to the same upload offset.
Repeated creation cannot truncate an existing partial upload. Mutating requests require
the configured same-origin Origin header; HEAD is read-only and does not require it.

pg-boss stores jobs in the `storage_jobs` schema of the same PostgreSQL database.
The HTTP process starts workers and stops them gracefully. No Redis or extra queue
service is required. Jobs handle finalizing uploads, copying, SHA-256 and permanent
removal. They are queued in the same transaction as catalog state changes and are
safe to retry. File processing uses separate transactions from catalog-wide changes.
Tus writes chunks and resumable JSON metadata directly into `.beacon-uploads` on
the selected storage, including SSHFS and each personal space's own root. Its standard
FileStore handles offsets and streaming writes; a thin routing adapter selects the
mounted directory by the upload's reserved node ID. There is no local full-file spool
or second copy. Unavailable remote mounts fail without falling back to a local folder.
A finalization worker checks the staged file's expected length, fsyncs it and computes
SHA-256 with a streaming read. It then publishes a hard link under the final name,
atomically refusing an existing destination. Staging bytes and final bytes are the
same inode. After the catalog transaction commits, the staging link and Tus metadata
are removed. Retries after publication reuse the staged file; cancellation and expiry
remove temporary data from the corresponding target space. Hidden partial uploads
never appear in the regular file list.
The destination filesystem must support hard links; unsupported mounts fail safely
without a partial final file or an overwrite. This was verified on the development
SSHFS mount. Large finalization/copy jobs have a 24-hour execution window.
This integrity check is
not antivirus scanning. Directory rename/move checks for a destination collision but,
as in the standalone application, cannot coordinate simultaneous external filesystem
renames. Avoid concurrent changes to the same paths from multiple applications.
After retries are exhausted, a failed operation is visible and can be retried.
Unfinished uploads older than seven days are scheduled for removal hourly.
The application database role must be able to create the pg-boss schema.

Back up the database and file volume together. Restoring only one loses the relationship
between catalog entries and file paths. Physical files are never publicly served.

## Verification

Run dependency operations, migrations and checks in Docker with the project's toolchain.
`tests/storage-validation.test.ts` covers the common adapter and filename boundaries.
`tests/storage-integration.ts` requires `APP_ENV=test` and a disposable migrated database;
it creates synthetic accounts and uses an isolated pg-boss schema and temporary files.
It must never target a development or production database.
`tests/browser-storage.ts` checks responsive navigation, filtering and previews using
synthetic API responses without changing development users.

The sidebar shows filesystem-available bytes and total capacity from `statfs`, plus
a used-space meter. These are disk figures shared by spaces on the same filesystem,
not per-user quotas or a sum of uploaded file sizes. Capacity is refreshed every
30 seconds while visible, on manual refresh, after file operations and on upload
completion. Unavailable mounts display no fabricated capacity values.

For deployment-specific mounts, keep a Compose override outside the repository and
include it in the external environment's COMPOSE_FILE together with the base Compose
file. Use `docker compose --env-file /path/to/deployment.env ...` so the complete file
set is retained; an explicit base-only `-f` overrides COMPOSE_FILE and removes those
mounts on recreation. Prefer long bind syntax with `create_host_path: false`, and mount
the same roots into every process that may handle file jobs. Mount the actual roots when sharing an existing filesystem tree. Do not replace them
with empty application-specific subdirectories. Personal folders default to Beacon
UUIDs; legacy numeric folders are not used as personal roots.

Administration → Storages manages group read/write grants for configured shared roots
and their folders. Personal roots are excluded. Select a storage and navigate to a
folder or the whole storage before granting access. The file browser has no permission
settings button. Storage creation and filesystem paths remain external configuration.
The file view places its transfer summary and storage notices beside the view title;
per-file controls are available by expanding the summary.

Shared views label the configured personal parent directory using the editable
«Название папки пользователей» field in Administration → Storages (default
«Пользователи»), and label
its `user-<Beacon UUID>` children with the matching user's first and last names.
These labels also appear in breadcrumbs and folder selectors. Names and paths on disk
are unchanged; operations still address UUIDs and real paths. Unknown/numeric folders
keep their real names. No standalone-user database or legacy mapping is used.

Upload reservations, partially received files and failed upload finalizations are excluded
from normal file listings, favorites and recent files. They remain accessible by their
creator through upload endpoints so Tus can resume them. The active transfer panel
shows their progress; completion refreshes the file list after the worker publishes
the verified file. Reloading the page does not turn an abandoned upload into a file.

Dragging files or folders from the desktop onto the main file workspace highlights
the upload area and feeds the existing resumable uploader. In the All Files view,
ready entries can also be dragged onto a listed folder or a breadcrumb to move them
within the current storage. These moves use the existing authenticated PATCH route;
permissions, collisions and directory-cycle checks remain enforced by the server.
The menu-based Move action remains available for touch and keyboard users.
