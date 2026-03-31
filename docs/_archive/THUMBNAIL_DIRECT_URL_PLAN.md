# Direct Thumbnail URL Plan

## Summary
Move thumbnail rendering to a direct URL contract:

`upload -> thumbnail-worker generation -> persisted thumbnail_url -> UI image src`

Basecamp runtime thumbnail display must not depend on Dropbox APIs or `/projects/:id/files/:fileId/thumbnail` proxy generation.

## Implementation Changes

### 1) basecamp-clone: Data Contract
- Add nullable `thumbnail_url text` to `project_files`.
- Ensure repository read/write models include `thumbnail_url` for all file list/detail fetches used by project and discussion pages.
- Migration target: new Supabase migration in `supabase/migrations`.

### 2) basecamp-clone: Upload Flow
- In `app/projects/[id]/files/upload-complete/route.ts`, call thumbnail-worker `POST /thumbnails` with uploaded file bytes and metadata.
- Persist returned `thumbnailUrl` into `project_files.thumbnail_url`.
- Default mode: best-effort thumbnailing (upload succeeds if thumbnail generation fails; persist `thumbnail_url = null` and log).

### 3) thumbnail-worker: API Contract
- Keep existing routes:
  - `POST [basePath]/thumbnails`
  - `GET [basePath]/thumbnails/:projectFileId.jpg`
- Extend POST response for `generated` and `reused` actions to include:
  - `thumbnailUrl` (absolute public URL to `GET /thumbnails/:projectFileId.jpg`)
- Keep `thumbnailPath` and `message` for diagnostics.
- Add config for canonical public URL construction (origin + optional base path aware), and log effective values at startup.

### 4) basecamp-clone: UI Read Path
- Project files and discussion attachment UIs must use `file.thumbnail_url` directly as the image source.
- If `thumbnail_url` is null, render a deterministic file-type placeholder and do not call the proxy thumbnail endpoint.

### 5) Legacy Route Transition
- Keep `app/projects/[id]/files/[fileId]/thumbnail/route.ts` only as temporary compatibility surface.
- Preferred transition behavior:
  - If file has `thumbnail_url`, redirect (302/307) to that URL.
  - If not, return stable placeholder/404 behavior without repeated expensive regeneration attempts.
- Remove route after backfill and traffic confirmation.

### 6) Backfill
- Run one-time backfill for existing rows with null `thumbnail_url`.
- For each eligible file: enqueue/call worker generation, update `thumbnail_url`, and record failures for retry.

## Interface Deltas

### Basecamp DB
- `project_files.thumbnail_url text null`

### Worker POST response
- Existing: `action`, `thumbnailPath`, `message`
- New: `thumbnailUrl` (required for `generated|reused`, omitted for `skipped`)

## Test Plan

### basecamp-clone
- Upload-complete persists `thumbnail_url` when worker returns success.
- Upload-complete keeps file creation successful when worker fails (default mode).
- Project page and discussion attachments use direct URLs and no longer issue `/thumbnail` fetches when `thumbnail_url` is absent.
- Repository/schema compatibility tests include `thumbnail_url`.

### thumbnail-worker
- `POST /thumbnails` returns `thumbnailUrl` with correct base path/origin for `generated|reused`.
- `GET /thumbnails/:projectFileId.jpg` serves persisted image bytes.
- Config tests validate public URL/base-path normalization.

### End-to-End
- Upload image/pdf/docx -> verify DB `thumbnail_url` populated -> UI renders direct image URL.
- Legacy files with null `thumbnail_url` show placeholder until backfilled.

## Defaults and Assumptions
- `POST /thumbnails` remains bearer-authenticated.
- `GET /thumbnails/:projectFileId.jpg` remains reachable by browser for direct rendering.
- Best-effort thumbnail generation is the default upload policy.
