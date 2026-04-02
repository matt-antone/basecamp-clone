# Round 7 — BC2 file discussion/comment linkage — implementation plan

**Status:** Complete (handoff 2026-04-01)  
**Spec:** [2026-04-01-round-7-bc2-file-discussion-linkage-design.md](../../specs/2026-04-01-round-7-bc2-file-discussion-linkage-design.md)

---

## Goal

Reduce incorrect **orphan** file rows by fixing import/mapping and optionally backfilling from BC2 metadata.

---

## Phase A — Investigation

- [x] **A1:** Inspect Supabase schema for `project_files` — linkage columns `thread_id` → `discussion_threads(id)`, `comment_id` → `discussion_comments(id)`; constraint `project_files_comment_requires_thread` (see design + migration `0007_comment_attachments.sql`).
- [x] **A2:** Staging / read-only orphan measurement — SQL documented in design (`thread_id IS NULL AND comment_id IS NULL` vs totals).
- [ ] **A3:** Sample orphan rows against BC2 raw export (optional stakeholder spot-check).
- [x] **A4:** **Root cause:** The files phase (`migrateFiles`) created rows with **null** `thread_id` / `comment_id` because it did not resolve BC2 **`attachable`** on each attachment. The thread phase did not import **`message.attachments`**, and list endpoints alone did not supply enough parent context without attachable resolution. Fix: resolve linkage via `resolveBc2AttachmentLinkage` / `resolveBc2LinkageFromAttachable` (`lib/imports/bc2-attachment-linkage.ts`), process message- and comment-level attachments in the thread phase, and backfill existing orphans with `scripts/backfill-bc2-file-linkage.ts`.

---

## Phase B — Forward fix

- [x] **B1:** **Attachable-based mapping** in BC2 file import: `migrateFiles` calls `resolveBc2AttachmentLinkage` so `createFileMetadata` receives `threadId` / `commentId` when `import_map_threads` / `import_map_comments` can resolve the attachment’s `attachable` (Message → thread; Comment → thread + comment).
- [x] **B2:** Migration order unchanged and correct: **threads → comments → files** (`scripts/migrate-bc2.ts` main flow); files phase runs after maps exist so attachable resolution can join to local IDs.
- [x] **B3:** Unit tests: `tests/unit/bc2-attachment-linkage.test.ts` (Message / Comment attachable → local linkage).

---

## Phase C — Backfill (if needed)

- [x] **C1:** Script `scripts/backfill-bc2-file-linkage.ts`: for orphans (via `import_map_files`), fetches `/projects/{id}/attachments/{id}.json`, uses `resolveBc2LinkageFromAttachable` on `body.attachable`, `UPDATE project_files` when resolvable.
- [x] **C2:** **Dry-run by default**; **`--confirm`** applies updates; **`--limit=N`** (default **100**).
- [ ] **C3:** Re-run orphan counts on staging/production after backfill (operational verification).

**npm:** `npm run backfill:bc2-file-linkage` (pass `--confirm` / `--limit=` as needed).

---

## Files (implemented)

| Area | Files |
|------|--------|
| BC2 migration | `scripts/migrate-bc2.ts` (`migrateFiles`, `migrateThreadsAndComments` message/comment attachments) |
| Linkage resolution | `lib/imports/bc2-attachment-linkage.ts` |
| Single-file import helper | `lib/imports/bc2-migrate-single-file.ts` |
| Backfill CLI | `scripts/backfill-bc2-file-linkage.ts` |
| Tests | `tests/unit/bc2-attachment-linkage.test.ts` |
| Schema | Existing `project_files` + `0007_comment_attachments.sql` (no Round 7 migration required for linkage columns) |

---

## Verification

- `npm run test`
- Staging: re-run orphan SQL from design; optional `npm run backfill:bc2-file-linkage -- --confirm` after review; new full imports should show linkage when BC2 `attachable` is present and maps exist.
