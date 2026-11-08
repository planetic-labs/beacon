# File cards and playlists

Storage is the source of truth. One card describes exactly one existing file:
video, audio, image or document. Its ID is the Storage file UUID. Title,
description, optional cover and chapters belong to that file independently of
publication. There are no secondary attachments or external links inside a card.

## Collections

- A folder can be shown as a playlist. Only its direct ready files are included,
  ordered by filename using deterministic C collation (use 01, 02 prefixes).
  Subfolders are separate and are not included recursively.
- Virtual playlists contain ordered file references. A file may belong to its
  folder playlist and any number of virtual playlists without copying bytes.
- Each collection has an explicit enabled setting. Enabling deliberately makes
  its files available to authenticated, unblocked community members via Materials.
  Source Storage permissions do not expand.
- Turning off a folder only removes that publication source: files referenced by
  another enabled virtual playlist remain published. Removing a virtual playlist
  removes references only. Neither action deletes file data, cards or progress.
- Moving a file changes its folder membership automatically. Virtual references
  stay attached to its UUID. Trash/unavailable ancestors hide it from every
  collection, including virtual ones. Restoring brings it back.

Folder settings and file cards use the existing Storage read/write checks.
Virtual playlist management follows the current admin-only Storage rollout and
also checks access to referenced files. Materials itself is read-only apart from
each viewer's own playback position.

## Processing and delivery

New files in enabled folders and newly selected virtual items acquire a default
card automatically. Completed uploads appear after becoming ready. External
filesystem additions are discovered by a bounded background folder scan when
the catalogue is requested (at most once per folder per 30 seconds). The browser
refreshes every 30 seconds, or two seconds while checks run.

Video accepts compatible MP4/H.264/yuv420p with AAC or no audio. Audio accepts
browser-compatible MP3, M4A/AAC, Ogg, WAV and FLAC codecs. FFprobe uses a fixed
demuxer and an inherited descriptor. No HLS, transcoding or video copies.
Byte hashes and probes run in a bounded background check outside SQL locks.
Documents/images do not require a full-file media hash or FFprobe.
Catalogue reads use database card data and bounded background availability
inspections instead of opening every remote file within the catalogue request.
Actual content delivery and direct detail requests still inspect the source;
cached catalogue availability never authorizes byte delivery.

Main-file fingerprint changes are checked before byte delivery. Changed media
content increments its revision, resets playback progress and requires chapter
review in Storage. Unchanged media after rename/move preserves progress.
An in-progress or unsuccessful verification never allows unverified playback.
Metadata editing does not synchronously reread the full recording.

Chapters and saved positions are shared across every playlist. Explicit
`/materials/<fileId>?t=seconds` takes priority over the viewer's saved position.
Authenticated GET/HEAD byte delivery supports Range. Video/audio hide their
download button in Materials; this is not DRM. Documents can be downloaded.
HTML/unknown formats are attachment downloads, never executable inline pages.

## API

- `GET /api/storage/:id/card`: file-owned card, verification state and canWrite;
  `PUT` replaces title, description, coverId, chapters, optional reviewed.
  Publication/attachment fields are not accepted.
- `GET|HEAD /api/storage/:id/card/content`, `/cover`: original Storage ACLs.
- `GET|PUT /api/storage/:folderId/playlist`: folder's `{enabled}` setting.
- `GET|POST /api/storage/playlists`, `PUT|DELETE .../:id`: virtual playlists
  with `{name, enabled, materialIds}`, order given by the array.
- `GET /api/materials`: deduplicated files and enabled folder/virtual playlists.
- `GET /api/materials/:fileId`, `GET|HEAD .../content`, `.../cover`:
  published view only; `.../video` remains a compatible delivery alias.
- `POST .../progress`: own viewer position with the current revision.
  Old Materials management routes and attachment delivery are disabled.

## Existing data

The physical `material`/chapter/progress identifiers remain unchanged to preserve
existing cards, chapters, covers, UUID links and viewer progress. The obsolete
per-card published flag is ignored; visibility comes only from collections.
Existing manual playlists become virtual playlists, initially disabled until
explicitly enabled in Storage. Legacy attachment rows are retained as archival
data but are neither displayed nor delivered. No migration moves or deletes
source files. The former Materials editor has been replaced by Storage editors.
