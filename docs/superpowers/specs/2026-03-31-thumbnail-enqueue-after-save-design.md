# Thumbnail job enqueue after file save — Design

**Date:** 2026-03-31  
**Status:** Approved

**Related code:** `lib/thumbnail-worker-notify.ts` (`notifyThumbnailWorkerBestEffort`), `lib/thumbnail-enqueue-after-save.ts` (`enqueueThumbnailJobAndNotifyBestEffort`), `app/projects/[id]/files/upload-complete/route.ts`, `lib/imports/bc2-migrate-single-file.ts`, `app/projects/[id]/files/[fileId]/thumbnail/route.ts`, `lib/repositories.ts` (`upsertThumbnailJob`, `createFileMetadata`).

**Implementation plan (closed):** `docs/superpowers/plans/closed/2026-03-31-thumbnail-enqueue-after-save.md`

**Companion spec (separate concern):** [Nightly BC2 sync (transition)](./2026-03-31-transition-nightly-bc2-sync-design.md).

---

## 1. Overview

After a file is successfully stored in Dropbox **and** a `project_files` row exists, **enqueue** a `thumbnail_jobs` row and **best-effort** notify the thumbnail worker so previews can warm before a user first requests the thumbnail URL.

This spec does **not** cover BC2 migration scheduling or `import_jobs`; see the companion spec.

---

## 2. Problem

Today **`thumbnail_jobs`** rows are created when **`GET .../files/[fileId]/thumbnail`** runs (`upsertThumbnailJob`). Upload and BC2 import paths persist full `project_files` rows (including `dropbox_file_id`, `dropbox_path`, `filename`, `mime_type`) but **do not** enqueue; the first viewer pays latency.

---

## 3. Data contract

- **Queue:** `thumbnail_jobs` needs only **`project_file_id`** (`uuid` from `createFileMetadata` return value).
- **Worker notify** (parity with `notifyWorkerBestEffort` in thumbnail route): `projectId`, `fileId`, `dropboxFileId`, `dropboxPath`, `filename`, `mimeType`, `jobId`, `status` — all available from the inserted file row + project id in context.

**Conclusion:** No new columns or Dropbox-only side channel required.

---

## 4. Behavior

1. After **successful** `createFileMetadata` (and only when `thumbnail_url` is null / empty if we want to avoid redundant work — **recommend** skip enqueue when `thumbnail_url` already set).
2. Call **`upsertThumbnailJob({ projectFileId: file.id })`**.
3. **Best-effort** notify thumbnail worker with same payload shape as `notifyWorkerBestEffort` (extract shared helper in `lib/` or thin shared module to avoid duplicating URL/token/body logic between route and upload/import).

**Failure policy:** Upload / import **succeeds** if enqueue or worker notify fails; log warnings (align with existing `thumbnail_worker_notify_skipped` pattern).

---

## 5. Call sites (minimum)

- **`app/projects/[id]/files/upload-complete/route.ts`** — after `createFileMetadata`.
- **`lib/imports/bc2-migrate-single-file.ts`** (or single choke point after successful `createFileMetadata` there) — after new import (not when returning `skipped_existing`).

---

## 6. Non-goals (v1)

- Backfill cron for all historical `project_files` with null `thumbnail_url` (optional follow-up).
- Changing worker’s supported MIME types or error taxonomy.

---

## 7. Testing expectations

- Unit or integration test: after upload-complete (mocked Dropbox), `upsertThumbnailJob` is invoked once with new file id; mock worker notify to assert payload fields.
- BC2 path: test hook or integration with mocked `uploadComplete` + metadata create.

---

## 8. Open questions

1. Confirm **skip enqueue** when `thumbnail_url` already populated (re-upload overwrite flow — if any — may need explicit re-queue rule).

---

## 9. Approval

- [x] Thumbnail enqueue behavior approved (best-effort, no hard dependency on worker).

Implementation plan archived at `docs/superpowers/plans/closed/2026-03-31-thumbnail-enqueue-after-save.md`.
