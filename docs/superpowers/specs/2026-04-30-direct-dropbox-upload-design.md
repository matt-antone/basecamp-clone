# Direct-to-Dropbox Upload Bypass — Design Spec

**Date:** 2026-04-30
**Refactor target:** `main` (the Vercel Blob bypass already shipped via PR #19 and is live in production; this spec rewrites that work against `main`).
**Working branch:** new `fix/direct-dropbox-upload` cut from current `main`. The original `fix/blob-upload-bypass` branch is ahead of main by only one trivial commit and will be closed out separately.
**Supersedes:** `docs/superpowers/plans/2026-04-29-blob-upload-bypass.md`

---

## Background

Production deploys to **Netlify**, not Vercel. The earlier plan (`2026-04-29-blob-upload-bypass.md`) was written under the wrong assumption that the deploy target enforced Vercel's 4.5 MB request body cap and proposed routing files through Vercel Blob as transient transit storage.

Netlify Functions (the runtime backing Next.js route handlers on Netlify) enforce a **6 MB synchronous request body cap** (AWS Lambda limit). iStock images reported by stakeholders (<10 MB) still bust that cap, so a bypass is still required — but for a different platform and different number than the original plan claimed.

Stakeholders also will not approve added vendor cost. Any solution that introduces transit storage (Vercel Blob, Supabase Storage, Cloudflare R2, etc.) adds at minimum egress cost per upload and another point of failure between browser and the canonical destination (Dropbox). This spec eliminates transit storage entirely.

## Goal

Allow project file uploads up to **150 MB** by routing file bytes directly from browser to Dropbox using a server-issued **Dropbox Temporary Upload Link** (`/2/files/get_temporary_upload_link`). The Next.js route handler only ever receives small JSON payloads, sidestepping the Netlify 6 MB body cap entirely. No transit storage, no new vendor, no added cost.

## Non-Goals

- Files larger than 150 MB (would require Dropbox `upload_session` API and a token in the browser; not justified by current workload).
- Reconciliation cron for Dropbox-orphan files left by browser disconnect mid-flow (deferred; rare; manual cleanup acceptable for MVP).
- Replacing the existing thumbnail-processing async flow (`thumbnail_status`) — out of scope; unchanged.

## Architecture

```
Browser pick file
  → POST /projects/[id]/files/upload-init
        body: { filename, mimeType, sizeBytes }
        guards: requireUser, getProject, assertClientNotArchivedForMutation
        size guard: sizeBytes ≤ 150 MB (reject pre-Dropbox)
        targetPath = ${projectStorageDir}/uploads/${filename}
        dropbox.filesGetTemporaryUploadLink({
          commit_info: { path: targetPath, mode: 'add', autorename: true }
        })
        returns: { uploadUrl, targetPath, requestId }

Browser PUT file → uploadUrl
  (direct to *.content.dropboxapi.com, CORS-enabled,
   single PUT up to 150 MB, link valid 4 hours,
   XHR for upload-progress events driving local progress bar)
  PUT response body = Dropbox FileMetadata: { id, path_display, content_hash, size, server_modified }
  Browser captures id + path_display from PUT response.

  → POST /projects/[id]/files/upload-complete
        body: { dropboxFileId, requestId, threadId?, commentId? }
        guards: requireUser, getProject, assertClientNotArchivedForMutation,
                getThread (if threadId), getComment (if commentId)
        dropbox.filesGetMetadata({ path: `id:${dropboxFileId}` })
          → { id, path_display, content_hash, size, server_modified }
        SECURITY GUARD: assert path_display.startsWith(`${getProjectStorageDir(project)}/uploads/`)
          else reject 403 — prevents attributing a file uploaded against project A to project B.
        createFileMetadata({
          projectId, uploaderUserId, filename: basename(path_display),
          mimeType, sizeBytes: size, dropboxFileId: id,
          dropboxPath: path_display, contentHash: content_hash,
          threadId?, commentId?
        })
        enqueueThumbnailJobAndNotifyBestEffort(...)
        returns: { file: <row> }
```

**Properties:**

- Zero transit storage. No `@vercel/blob`, no Supabase Storage, no Netlify Blobs.
- Zero `after()` background work. Both routes complete synchronously in <500 ms.
- Dropbox token never leaves the server.
- Browser only ever talks to: app routes (small JSON) + Dropbox content URL (file bytes).
- File ceiling **150 MB**, far above current workload (iStock <10 MB).

## Components Affected

### Server

- **`lib/storage/dropbox-adapter.ts`** — add two methods:
  - `getTemporaryUploadLink({ targetPath })` → wraps `dropbox.filesGetTemporaryUploadLink({ commit_info: { path, mode: 'add', autorename: true } })`. Returns `{ uploadUrl, expiresAt }`.
  - `getFileMetadata({ path })` → wraps `dropbox.filesGetMetadata({ path })`. Returns `{ fileId, pathDisplay, contentHash, size, serverModified }`.

- **`app/projects/[id]/files/upload-init/route.ts`** — replace the current Vercel Blob `handleUpload` flow. New body schema (zod):
  ```ts
  { filename: string.min(1), mimeType: string.min(1), sizeBytes: number.int().positive().max(150 * 1024 * 1024) }
  ```
  Returns `{ uploadUrl: string, targetPath: string, requestId: string }`.

- **`app/projects/[id]/files/upload-complete/route.ts`** — replace the current transit-fetch + `after()` flow. New body schema:
  ```ts
  {
    dropboxFileId: string.regex(/^id:[A-Za-z0-9_-]+$/) | string.min(1),
    requestId: string,
    threadId?: uuid,
    commentId?: uuid  // requires threadId
  }
  ```
  Calls `filesGetMetadata({ path: 'id:' + dropboxFileId })`, asserts `path_display` is inside the project's storage prefix, creates row in one shot, returns the row.

### Dead-code inventory (everything `@vercel/blob` / `transfer_*` / `blob_url` touched on `main`)

A full audit against `main` produced the list below. Every item must land in this refactor — leaving any one in is dead code.

**Server code:**

- `app/projects/[id]/files/upload-init/route.ts` — REWRITE (remove `import { handleUpload } from "@vercel/blob/client"`, all Vercel Blob token logic).
- `app/projects/[id]/files/upload-complete/route.ts` — REWRITE (remove `import { del } from "@vercel/blob"`, transit-fetch, `after()`, hostname allowlist, all `transfer_status` mutations).
- `lib/repositories.ts` —
  - Delete `markFileTransferInProgress` (line ~1569)
  - Delete `finalizeFileMetadataAfterTransfer` (line ~1578)
  - Delete `markFileTransferFailed` (line ~1597)
  - Remove `blob_url`, `status`, `transfer_error` from the `createFileMetadata` INSERT (line ~1494)
- `lib/config-core.ts` — delete `blobReadWriteToken` getter (lines 151–156).
- `lib/imports/bc2-migrate-single-file.ts` — remove `blobUrl: null` argument (line 159).
- `lib/imports/basecamp2-import.ts` — remove `blobUrl: null` argument (line 268).

**Browser code:**

- `app/[id]/[discussion]/page.tsx` —
  - Remove `import { upload } from "@vercel/blob/client"` (line 10)
  - Replace `upload(file.name, file, { handleUploadUrl: ... })` block (lines 483–509) with the new init → XHR PUT → complete sequence
  - Remove `blobUrl` from `/upload-complete` payload
- `app/[id]/page.tsx` —
  - Remove `import { upload } from "@vercel/blob/client"` (line 11)
  - Remove `transfer_error: string | null` from local types (line 80)
  - Replace `upload(...)` block (lines 461–471) with the new init → XHR PUT → complete sequence
- `components/projects/project-files-panel.tsx` —
  - Remove `transfer_error: string | null` and `pending`/`in_progress` from the `status` union (line 14)
  - Remove `isPending` logic (line 135)
  - Remove transient-status badges (lines 165, 196)

**Database:**

- New migration `supabase/migrations/0025_revert_project_files_transfer_status.sql` (next free number — `0023_project_files_transfer_status.sql` and `0024_clients_github_repos_and_domains.sql` already exist; the original `0023_*` was a duplicate-numbered migration to leave alone). The revert drops `transfer_status`, `transfer_error`, `blob_url` from `project_files` using `IF EXISTS` so it is idempotent regardless of whether `0023_project_files_transfer_status.sql` has been applied to a given environment.
- **Do not edit** `0023_project_files_transfer_status.sql` — preserve forward history.

**Tests:**

- `tests/unit/upload-init-route.test.ts` — REWRITE (Vercel Blob `handleUpload` mocks gone; new mock = `dropbox.filesGetTemporaryUploadLink`).
- `tests/unit/upload-complete-route.test.ts` — REWRITE (drop `@vercel/blob` `del()` mock, `after()` invocation harness, hostname-allowlist tests).
- `tests/unit/project-activity-touch.test.ts` — remove `blobUrl: null` test fixture (line 133).
- `tests/unit/mcp-dropbox.test.ts` — leave alone; the `"blob data"` strings on lines 118/131 are unrelated test fixture content, not Vercel Blob references.
- `lib/storage/dropbox-adapter.test.ts` — extend with `getTemporaryUploadLink` and `getFileMetadata` cases.

**Config / package:**

- `package.json` — drop `@vercel/blob` dep.
- `pnpm-lock.yaml` — refresh after dep removal.
- `.env.example` — drop the `BLOB_READ_WRITE_TOKEN` line.

**Verification (must pass before merge):**

- `pnpm fallow dead-code` — must report **zero** unreachable exports introduced or left behind by this refactor. (`fallow` is already a project dev-dep.)
- `grep -rE '@vercel/blob|blob_url|blobUrl|transfer_status|transfer_error|markFileTransfer|finalizeFileMetadataAfterTransfer|BLOB_READ_WRITE_TOKEN|blobReadWriteToken' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.sql' .` — must return only the new revert migration `0025_*.sql` and (if archived for history) the old `0023_*.sql` and `0029-04-29-blob-upload-bypass.md` plan doc.
- `pnpm tsc --noEmit` — clean.
- `pnpm vitest run` — all green.

### Browser

- File picker handler in:
  - Project Files tab upload control
  - Discussion comment-attachment flow (`app/[id]/[discussion]/page.tsx` or wherever the existing comment-attachment upload lives)
- Replace `upload()` from `@vercel/blob/client` with:
  1. `fetch('/upload-init', { POST, body: { filename, mimeType, sizeBytes } })` → `{ uploadUrl, targetPath, requestId }`
  2. `XMLHttpRequest` PUT to `uploadUrl` with raw `File` body. Use `xhr.upload.onprogress` to drive the progress bar (the Fetch API does not expose upload progress).
  3. `fetch('/upload-complete', { POST, body: { targetPath, requestId, threadId?, commentId? } })` → returns row, append to UI list.
- On any error: toast + retry option. **No DB cleanup needed** because no DB row is created until `/upload-complete` succeeds.

## Data Flow & Error Handling

### Happy path timing

| Step | Operation | Typical duration |
|---|---|---|
| T0 | browser → `/upload-init` | ≤ 200 ms |
| T1 | browser → Dropbox PUT | real-time, < 10 s for iStock |
| T2 | browser → `/upload-complete` | ≤ 500 ms |
| T3 | row visible in UI | — |
| T4 | thumbnail enqueue (existing) | async, unchanged |

### Error matrix

| Stage | Failure | DB state | User sees | Recovery |
|---|---|---|---|---|
| `/upload-init` | guard rejects (auth, archived, project) | none | error toast | fix auth / unarchive |
| `/upload-init` | Dropbox API 5xx | none | error toast | retry |
| Browser PUT | network drop | none | toast w/ retry | re-PUT same `uploadUrl` (4-hour validity) or restart |
| Browser PUT | Dropbox 5xx | none | error toast | retry; restart from `/upload-init` on persistent |
| Browser PUT | 401 (link expired) | none | error toast | restart from `/upload-init` |
| Browser PUT | succeeds, tab closes before `/upload-complete` | **none in DB**, file orphan in Dropbox at `targetPath` | nothing | accept (out-of-scope reconciliation cron) |
| `/upload-complete` | metadata `path_not_found` | none | error toast | retry; log if persistent |
| `/upload-complete` | DB insert fails | none | error toast | retry |

### Single residual orphan class

PUT-success-then-disconnect leaves a file in Dropbox without a row. Risk profile is identical to a user uploading and then deleting manually — Dropbox holds the file, the app does not surface it. Acceptable for MVP. If stakeholders later require zero orphans, add a daily Netlify Scheduled Function that lists `${projectStorageDir}/uploads/` paths, diffs against `project_files.dropbox_path`, and trash-cans unmatched objects. **Explicitly out of scope.**

### Auth on the temporary upload URL

The URL itself carries authorization — any client with the URL can perform the single PUT it authorizes within 4 hours. Treat as a secret:

- HTTPS only.
- Never logged.
- Returned only to the authenticated requester (response of `/upload-init`).
- Not persisted server-side.

### Path collisions

`commit_info.mode = 'add'` with `autorename: true` makes Dropbox append `(1)`, `(2)` etc. on conflict. The Dropbox PUT response carries the **actual** stored `path_display` and `id`. `/upload-complete` is keyed by `dropboxFileId` (immutable), so autorename is naturally accommodated — the row stores `path_display` from `filesGetMetadata`, and the displayed `filename` is derived from that `path_display`'s basename so the UI matches the canonical Dropbox name.

### Project-attribution guard

Because `/upload-complete` accepts a `dropboxFileId` from the client, an authenticated user could otherwise pass a file id from another project's folder and attribute it to the project in the URL. The route must enforce:

```
assert path_display.startsWith(`${getProjectStorageDir(project)}/uploads/`)
```

before persisting. Failures map to 403. This is the security boundary that replaces the old plan's "Vercel Blob hostname allowlist" check.

## Testing

### Unit tests (Vitest, mocked Dropbox SDK)

**`tests/unit/upload-init-route.test.ts`** (rewrite)

- 200: returns `{ uploadUrl, targetPath, requestId }` for authed user on valid project
- 401: missing or invalid bearer
- 404: unknown project id
- 409: client archived or archive-in-progress
- 400: missing or malformed `filename` / `mimeType` / `sizeBytes`
- 400: `sizeBytes > 150 MB` rejected before any Dropbox call
- 500: Dropbox `filesGetTemporaryUploadLink` throws → logged + `serverError()`

**`tests/unit/upload-complete-route.test.ts`** (rewrite)

- 200: metadata fetched, row created with `dropbox_file_id`, `dropbox_path` = `path_display`, `content_hash`, `size`, status `ready`; thumbnail enqueue invoked
- 200 + comment attachment: `threadId` + `commentId` validated and persisted onto the row
- 401, 404, 409: same guards as `upload-init`
- 400: zod validation including `commentId` without `threadId`
- 403: `path_display` outside `${projectStorageDir}/uploads/` (cross-project attribution attempt) — **security regression test**
- 404: Dropbox `filesGetMetadata` returns `path_not_found` → mapped to user-facing error
- 500: DB insert fails → no orphan persistence; clear error

**`lib/storage/dropbox-adapter.test.ts`** (extend)

- `getTemporaryUploadLink` calls SDK with correct `commit_info` shape (`mode: 'add'`, `autorename: true`)
- `getFileMetadata` returns normalized fields the route consumes

### Tests dropped

- All transfer-status repository helper tests (`markFileTransferInProgress`, `markFileTransferFailed`, `finalizeFileMetadataAfterTransfer`)
- `after()` background-task tests added by commit `907389c`
- Vercel Blob hostname-allowlist tests added by commit `41f63b8`

### Integration smoke (manual checklist in plan)

1. Real Dropbox dev account, real refresh token in `.env.local`.
2. Pick 8 MB iStock JPG → file appears in list with thumbnail.
3. Pick 30 MB PDF → file appears.
4. Pick 200 MB file → client-side rejection before `/upload-init`.
5. DevTools throttle to slow 3G mid-PUT → progress bar accurate, retry succeeds.
6. Temporarily revoke Dropbox app token → `/upload-init` 5xx surfaces in toast.
7. Upload same filename twice → second persists as `name (1).ext`; row reflects autorenamed `path_display`.
8. Comment-attachment flow on a discussion → file linked to comment, visible in thread.

## Out of Scope

- Files >150 MB (would require `upload_session` and a browser-held OAuth token).
- Reconciliation cron for Dropbox orphans from browser disconnect mid-flow.
- Email notification on upload failure (toast is sufficient).
- Concurrency-stress tests on identical-name uploads (Dropbox autorename handles correctness; no test value).

## Migration Sequence

1. Cut new branch `fix/direct-dropbox-upload` from current `main`.
2. Write revert migration `supabase/migrations/0025_revert_project_files_transfer_status.sql` (idempotent `DROP COLUMN IF EXISTS`).
3. Drop `@vercel/blob` from `package.json`; refresh `pnpm-lock.yaml`.
4. Rewrite `upload-init`, `upload-complete`, extend `lib/storage/dropbox-adapter.ts`.
5. Apply dead-code inventory above (browser, repositories, config-core, imports, components, tests, `.env.example`).
6. Apply migration in dev → `pnpm tsc --noEmit` → `pnpm vitest run` → `pnpm fallow dead-code` → manual smoke checklist → push PR.
7. On merge to `main`: apply migration in production **before** promoting the app deploy (or together with the deploy if the migration runner is gated by deploy in this project's pipeline).

## Pre-deploy operational checklist

The revert migration `0025_revert_project_files_transfer_status.sql` re-imposes `NOT NULL` on `project_files.dropbox_file_id`, `dropbox_path`, and `checksum`. Production has been running PR #19 (Vercel Blob) and may have rows left in `pending` or `in_progress` state with NULL Dropbox columns. Those rows will fail the migration with a `not-null constraint violation` and the migration will roll back.

**Before applying `0025` to any environment, run this probe:**

```sql
select count(*) as null_rows
from project_files
where dropbox_file_id is null
   or dropbox_path is null
   or checksum is null;
```

- **If the count is `0`:** apply the migration normally.
- **If the count is non-zero:** investigate per-row. Each row represents an upload that started under the Vercel Blob flow but never completed.
  - Rows `status = 'failed'` with no Dropbox metadata: safe to delete (the user already saw an error and re-tried). `delete from project_files where status = 'failed' and dropbox_file_id is null;`
  - Rows `status = 'pending'` or `'in_progress'`: confirm with the uploading user; either delete or wait briefly for completion before retrying. A short upload freeze (~5 min) before the migration window is the safest path.

After cleanup, re-run the probe to confirm `null_rows = 0`, then apply the migration.

## Risks

- **Dropbox CORS surface change.** Dropbox content endpoints have supported CORS for years on `*.content.dropboxapi.com`, but if a corporate proxy or browser extension blocks third-party uploads, users will see PUT failures. **Mitigation:** error matrix surfaces this clearly; documented as a known limitation.
- **Temporary link 4-hour TTL.** If a user pauses an upload longer than 4 hours, the link expires. **Mitigation:** browser detects 401 from PUT and offers restart (which re-mints a fresh link).
- **Dropbox rate limits on `get_temporary_upload_link`.** Per-user rate limit; only invoked once per upload. **Mitigation:** unlikely to hit in normal usage; 429 from Dropbox is surfaced as transient error with retry.
- **`path_display` vs requested path mismatch on autorename.** Caller must use `path_display`. **Mitigation:** explicit in implementation + tested.
