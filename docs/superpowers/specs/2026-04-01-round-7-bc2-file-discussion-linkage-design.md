# Round 7 — Bug: files missing discussion/comment linkage after BC2 migration

**Date:** 2026-04-01  
**Status:** Implemented (handoff 2026-04-01)  
**Type:** Bug / data quality

---

## Problem

In production data review, **more files** than expected had **no `thread_id` / `comment_id`** — i.e. they were **orphaned** from discussions and comments. In typical Basecamp usage, most attachments are **on** a message or comment; true orphans should be rare.

---

## Hypotheses (investigate)

1. **Importer** omits `thread_id` / `comment_id` when BC2 payload maps incorrectly. **→ Confirmed for the files phase:** linkage was not derived from BC2 **`attachable`** before insert.
2. **Upload path** without thread context. **→ Same as (1)** for the bulk attachments phase.
3. **Migration order**: files imported before threads/comments exist. **→ Partial:** order was threads/comments then files, but the **files phase** still inserted nulls without attachable resolution; **message-level attachments** were not processed in the thread phase.
4. **Duplicate skip**: dedupe logic creates file row without re-linking. **→ Not the primary driver;** idempotency remains via `import_map_files`.

---

## Goal

1. **Measure:** SQL below for files with `thread_id IS NULL AND comment_id IS NULL`.
2. **Root cause:** Forward path resolves **`attachment.attachable`** (Message / Comment) to local IDs via `import_map_threads` / `import_map_comments`; thread phase imports **`message.attachments`** (and existing comment attachments).
3. **Backfill:** One-time job `scripts/backfill-bc2-file-linkage.ts` for existing orphans using per-attachment JSON and `attachable`.

---

## Schema (linkage)

| Column | Purpose |
|--------|---------|
| `project_files.thread_id` | Optional FK to `discussion_threads` — set when file belongs to a discussion (message or comment thread). |
| `project_files.comment_id` | Optional FK to `discussion_comments` — set when file is on a **comment**; must agree with `project_files_comment_requires_thread`. |

Migrations: `0001_init.sql` (`project_files`), `0007_comment_attachments.sql` (comment/thread columns + constraint).

---

## Staging / read-only SQL (orphan measurement)

```sql
-- Orphan count
select count(*) as orphan_files
  from project_files
 where thread_id is null
   and comment_id is null;

-- Total files (context)
select count(*) as total_files from project_files;

-- Optional: orphans that still map to a BC2 file id (candidates for backfill)
select count(*) as orphan_bc2_mapped
  from project_files pf
  join import_map_files imf on imf.local_file_id = pf.id
 where pf.thread_id is null
   and pf.comment_id is null;
```

---

## Non-goals

- Guaranteeing zero orphans (some exports may lack parent metadata or attachable).
- Changing user-facing file UX in this pass unless required for verification.

---

## Requirements (implementation)

1. **Documented** expected linkage columns (above).
2. **Tests** for attachable resolution: `tests/unit/bc2-attachment-linkage.test.ts`.
3. **Backfill:** idempotent-safe updates (only when still orphan), **dry-run default**, **`--confirm`** to apply, **`--limit`**, logging per row.

---

## Backfill script

- **Path:** `scripts/backfill-bc2-file-linkage.ts`
- **npm:** `npm run backfill:bc2-file-linkage`
- **Flags:** **`--confirm`** (required to write DB; default is dry-run), **`--limit=N`** (default **100**).
- **Env:** Same BC2 credentials as migration (`BASECAMP_*`, `DATABASE_URL`, optional `BASECAMP_REQUEST_DELAY_MS`).

---

## Exit criteria

- [x] Forward import uses **attachable-based** resolution in `migrateFiles` and processes **`message.attachments`** in the thread phase.
- [x] Backfill script available with dry-run / confirm / limit.
- [ ] Staging/production orphan rate re-measured after optional backfill (operational).
- [ ] Stakeholder spot-check: sample remaining orphans vs **known** missing BC2 metadata vs **bug** (optional).

---

## Implementation notes (Phase B / C)

- **`migrateFiles`** (`scripts/migrate-bc2.ts`): For each attachment from `fetchAttachments`, **`resolveBc2AttachmentLinkage(query, attachment)`** reads `attachment.attachable` and maps Message/Comment to local `thread_id` / `comment_id` before `importBc2FileFromAttachment`.
- **`migrateThreadsAndComments`:** After each message thread is mapped, if `--files`, iterates **`message.attachments`** and imports with explicit **`threadId`** (and `commentId: null`); comment attachments unchanged (thread + comment ids).
- **Order:** Projects → people → **threads & comments** (with optional file imports on messages/comments) → **files** phase.
