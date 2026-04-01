# Thumbnail enqueue after file save — Implementation Plan

> **STATUS: CLOSED** (2026-04-01) — Implemented in `lib/thumbnail-worker-notify.ts`, `lib/thumbnail-enqueue-after-save.ts`, `app/projects/[id]/files/[fileId]/thumbnail/route.ts`, `app/projects/[id]/files/upload-complete/route.ts`, and `lib/imports/bc2-migrate-single-file.ts`. Tests: `tests/unit/thumbnail-enqueue-after-save.test.ts`, `tests/unit/upload-complete-route.test.ts`, `tests/unit/bc2-migrate-single-file.test.ts`, `tests/unit/file-thumbnail-route.test.ts`. Task checkboxes below are archival.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a file row is persisted (`createFileMetadata`), enqueue a `thumbnail_jobs` row and best-effort notify the thumbnail worker so previews can warm before the first `GET .../thumbnail` request.

**Architecture:** Extract worker notify logic from `app/projects/[id]/files/[fileId]/thumbnail/route.ts` into a small `lib/` module so upload-complete and BC2 import share the same URL/token/body behavior. Add a single orchestration helper (enqueue + status mapping + notify) callable from `upload-complete/route.ts` and `lib/imports/bc2-migrate-single-file.ts`. Failures in enqueue or notify must not fail the upload/import; log with the existing `thumbnail_worker_notify_skipped` pattern.

**Tech stack:** Next.js App Router route handlers, `lib/repositories.ts` (`upsertThumbnailJob`, `createFileMetadata`), `lib/config.ts` (`thumbnailWorkerUrl`, `thumbnailWorkerToken`), Vitest (`tests/unit`).

**Spec:** `docs/superpowers/specs/2026-03-31-thumbnail-enqueue-after-save-design.md`

---

## File structure (planned)

| File | Role |
|------|------|
| `lib/thumbnail-worker-notify.ts` (new) | Shared `notifyThumbnailWorkerBestEffort` + `logThumbnailWorkerNotifySkipped` (moved from thumbnail route). Same POST body as current `notifyWorkerBestEffort` in `thumbnail/route.ts` lines 167–187. |
| `lib/thumbnail-enqueue-after-save.ts` (new) | `enqueueThumbnailJobAndNotifyBestEffort({ projectId, fileRecord, requestId? })`: skip if `thumbnail_url` non-empty; `upsertThumbnailJob`; on `permanent_failure` skip notify; map `responseStatus` (`deduped` → `"processing"`, else `"queued"`); call notify. Wrap enqueue/notify in try/catch — log errors, never throw. |
| `app/projects/[id]/files/[fileId]/thumbnail/route.ts` | Import shared notify from `lib/thumbnail-worker-notify.ts`; keep GET flow; remove duplicated private `notifyWorkerBestEffort` / `logThumbnailWorkerNotifySkipped` bodies. |
| `app/projects/[id]/files/upload-complete/route.ts` | After successful `createFileMetadata` (lines 138–152), call `enqueueThumbnailJobAndNotifyBestEffort` with `projectId: id`, `fileRecord: file as Record<string, unknown>`, `requestId` from `crypto.randomUUID()` or header. |
| `lib/imports/bc2-migrate-single-file.ts` | After `createFileMetadata` succeeds and `localFileId` is known (before or after `import_map_files` insert — prefer immediately after metadata create, line ~118), call same helper with `projectId: args.projectLocalId`, `fileRecord` from returned row. Do **not** call on `skipped_existing` paths. |
| `tests/unit/upload-complete-route.test.ts` | Mock new module or `upsertThumbnailJob` + fetch; assert enqueue once with `projectFileId`; upload still 201 if notify fails. |
| `tests/unit/bc2-migrate-single-file.test.ts` | Extend mocks to cover enqueue path once per successful import. |
| `tests/unit/file-thumbnail-route.test.ts` | Adjust only if imports break after moving notify (re-mock `lib/thumbnail-worker-notify` if needed). |

**Open question (from spec §8):** Confirm skip when `thumbnail_url` already set — default **yes** for v1; document if re-upload flow must force re-queue later.

---

### Task 1: Extract `notifyThumbnailWorkerBestEffort` to `lib/thumbnail-worker-notify.ts`

**Files:**
- Create: `basecamp-clone/lib/thumbnail-worker-notify.ts`
- Modify: `basecamp-clone/app/projects/[id]/files/[fileId]/thumbnail/route.ts` (replace inline `notifyWorkerBestEffort` with import)

- [ ] **Step 1: Add `lib/thumbnail-worker-notify.ts`**

Move `normalizeBearerToken`, `notifyWorkerBestEffort` (rename export to `notifyThumbnailWorkerBestEffort` for clarity), and `logThumbnailWorkerNotifySkipped` from `thumbnail/route.ts` lines 127–234 (omit route-only `logThumbnailProxyCheck` / `logThumbnailJobEnqueued` — those stay in the route).

Public export shape:

```ts
export async function notifyThumbnailWorkerBestEffort(args: {
  projectId: string;
  fileId: string;
  requestId: string;
  responseStatus: "queued" | "processing";
  fileRecord: Record<string, unknown>;
  jobId: string | null;
}): Promise<void>;
```

- [ ] **Step 2: Update thumbnail route** to import `notifyThumbnailWorkerBestEffort` and call it where `notifyWorkerBestEffort` was called (line 71).

- [ ] **Step 3: Run tests**

Run: `cd basecamp-clone && npx vitest run tests/unit/file-thumbnail-route.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/thumbnail-worker-notify.ts app/projects/\[id\]/files/\[fileId\]/thumbnail/route.ts
git commit -m "refactor: extract thumbnail worker notify helper to lib"
```

---

### Task 2: Add `enqueueThumbnailJobAndNotifyBestEffort` orchestration

**Files:**
- Create: `basecamp-clone/lib/thumbnail-enqueue-after-save.ts`
- Modify: `basecamp-clone/lib/thumbnail-enqueue-after-save.ts`
- Test: `basecamp-clone/tests/unit/thumbnail-enqueue-after-save.test.ts` (new)

- [ ] **Step 1: Write failing unit tests** for `enqueueThumbnailJobAndNotifyBestEffort`

Behaviors to cover:
- Skips `upsertThumbnailJob` when `fileRecord.thumbnail_url` is a non-empty string.
- Calls `upsertThumbnailJob({ projectFileId: file.id })` when `thumbnail_url` null/empty.
- Does not call notify when `upsertThumbnailJob` returns `action: "permanent_failure"`.
- Calls `notifyThumbnailWorkerBestEffort` with `responseStatus` `"processing"` when job action is `deduped`, else `"queued"` for `inserted` (match `thumbnail/route.ts` lines 65–77).
- Swallows errors from `upsertThumbnailJob` / notify (test with mocked rejections — assert no throw, optional spy on `console.warn`).

Mock `@/lib/repositories` and `@/lib/thumbnail-worker-notify`.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/unit/thumbnail-enqueue-after-save.test.ts`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement `lib/thumbnail-enqueue-after-save.ts`**

- Import `upsertThumbnailJob` from `@/lib/repositories`.
- Import `notifyThumbnailWorkerBestEffort` from `@/lib/thumbnail-worker-notify`.
- `getNonEmptyString` for thumbnail: copy small helper from thumbnail route or inline check for non-empty `thumbnail_url` string.
- `fileId` = `String(fileRecord.id)`; guard if missing.
- `requestId` default `randomUUID()` from `node:crypto` when omitted.
- try/catch around enqueue + notify; on failure `console.warn` with context (align with `thumbnail_worker_notify_skipped` or a dedicated tag like `thumbnail_enqueue_after_save_failed` — keep one line per spec “log warnings”).

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/unit/thumbnail-enqueue-after-save.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/thumbnail-enqueue-after-save.ts tests/unit/thumbnail-enqueue-after-save.test.ts
git commit -m "feat: enqueue thumbnail job and notify worker after file save (helper)"
```

---

### Task 3: Wire `upload-complete` route

**Files:**
- Modify: `basecamp-clone/app/projects/[id]/files/upload-complete/route.ts`
- Modify: `basecamp-clone/tests/unit/upload-complete-route.test.ts`

- [ ] **Step 1: Write/adjust failing test** — mock `enqueueThumbnailJobAndNotifyBestEffort` from `@/lib/thumbnail-enqueue-after-save` (or mock repositories + notify). Assert it runs once after `createFileMetadata` with `projectId` and file id `file-1`. Rename tests that say “no thumbnail side effects” to expect enqueue + best-effort notify.

- [ ] **Step 2: Run test — expect FAIL** if implementation not wired.

Run: `npx vitest run tests/unit/upload-complete-route.test.ts`

- [ ] **Step 3: Implement** — after `const file = await createFileMetadata(...)` and null check, call:

```ts
await enqueueThumbnailJobAndNotifyBestEffort({
  projectId: id,
  fileRecord: file as Record<string, unknown>,
  requestId: request.headers.get("x-request-id")?.trim() || randomUUID()
});
```

Add imports: `randomUUID` from `node:crypto`, `enqueueThumbnailJobAndNotifyBestEffort` from `@/lib/thumbnail-enqueue-after-save`.

- [ ] **Step 4: Run tests — PASS**

Run: `npx vitest run tests/unit/upload-complete-route.test.ts`

- [ ] **Step 5: Commit**

```bash
git add app/projects/\[id\]/files/upload-complete/route.ts tests/unit/upload-complete-route.test.ts
git commit -m "feat: enqueue thumbnail job after upload-complete"
```

---

### Task 4: Wire BC2 single-file import

**Files:**
- Modify: `basecamp-clone/lib/imports/bc2-migrate-single-file.ts`
- Modify: `basecamp-clone/tests/unit/bc2-migrate-single-file.test.ts`

- [ ] **Step 1: Add test** — when import succeeds (`imported`), expect `enqueueThumbnailJobAndNotifyBestEffort` called once with `projectLocalId` and file id from `createFileMetadata` mock. When `skipped_existing`, expect **not** called.

- [ ] **Step 2: Implement** — after `fileRecord` is non-null (line ~117), `await enqueueThumbnailJobAndNotifyBestEffort({ projectId: args.projectLocalId, fileRecord: fileRecord as Record<string, unknown>, requestId: \`bc2-${args.jobId}-${attachment.id}\` })` (or `randomUUID()` — stable correlation is nice for logs).

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/unit/bc2-migrate-single-file.test.ts`

- [ ] **Step 4: Commit**

```bash
git add lib/imports/bc2-migrate-single-file.ts tests/unit/bc2-migrate-single-file.test.ts
git commit -m "feat: enqueue thumbnail job after BC2 file import"
```

---

### Task 5: Regression sweep

- [ ] **Run full unit suite**

Run: `cd basecamp-clone && npm run test`
Expected: all PASS

- [ ] **Step 2: Update design spec status** (optional, if human approved) — set `2026-03-31-thumbnail-enqueue-after-save-design.md` Status to Approved and check approval box.

- [ ] **Step 3: Final commit** (if doc-only)

```bash
git add docs/superpowers/specs/2026-03-31-thumbnail-enqueue-after-save-design.md
git commit -m "docs: mark thumbnail enqueue-after-save design approved"
```

---

## References

- @superpowers:subagent-driven-development — task-by-task execution
- @superpowers:executing-plans — inline batch with checkpoints
- @superpowers:verification-before-completion — before claiming done

## Plan review

After drafting, run the plan-document reviewer loop from `writing-plans` SKILL (review `docs/superpowers/plans/closed/2026-03-31-thumbnail-enqueue-after-save.md` against `docs/superpowers/specs/2026-03-31-thumbnail-enqueue-after-save-design.md`); fix any issues within three iterations or escalate to the human.

---

## Schema / env / API

- **Schema:** No new migrations; uses existing `thumbnail_jobs` and `project_files`.
- **Env:** No new variables; reuses `THUMBNAIL_WORKER_*` via `lib/config` (same as thumbnail route).
- **API:** No new HTTP routes; behavior change only on upload-complete POST and BC2 import path.
