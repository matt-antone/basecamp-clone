# BC2 comment attachment migration — implementation plan

> **STATUS: CLOSED** (2026-03-31) — `lib/imports/bc2-attachment-download.ts`, `bc2-migrate-single-file.ts`, and comment-phase attachment import in `scripts/migrate-bc2.ts` are in-repo. Plan checkboxes below were left stale; treat this file as archival. Do not dispatch new work without a new plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `migrate-bc2.ts` runs with `--files`, import Basecamp 2 attachments that appear on **discussion comments** into `project_files` with `thread_id` and `comment_id` set, using the same `basecamp_file_id` idempotency as the existing project-wide file phase so each BC2 attachment yields **at most one** local row.

**Architecture:** Keep **threads/comments before files** (`migrate-bc2.ts` main). After each comment is mapped to a local `discussion_comments` row, run a shared “import one BC2 attachment if not already in `import_map_files`” path: download (same auth / 429 behavior as today), upload to Dropbox under the project `storageDir`, `createFileMetadata({ ..., threadId, commentId })`, then `insert into import_map_files`. The existing `migrateFiles` phase continues to process `/projects/{id}/attachments.json`; its idempotency check skips any file already mapped when the comment phase imported it first. Extract download/retry logic into a small testable module to avoid duplicating HTTP behavior.

**Tech stack:** TypeScript, `tsx` CLI script, `pg` `Pool`, existing `Bc2Fetcher` / `Bc2Attachment`, `DropboxStorageAdapter`, `createFileMetadata` from `lib/repositories`, Vitest.

---

## File map

| File | Responsibility |
|------|------------------|
| `lib/imports/bc2-attachment-download.ts` | **Create** — Download a single attachment URL with Basic auth fallback, 429 backoff pattern aligned with `migrate-bc2.ts`. |
| `scripts/migrate-bc2.ts` | **Modify** — Pass `includeFiles` into thread/comment migration; after each comment has a local id, import `comment.attachments`; optionally handle message-level attachments (see Task 5). Refactor `migrateFiles` to call shared import helper where practical. |
| `lib/imports/bc2-fetcher.ts` | **Modify** — Add optional `attachments?: Bc2Attachment[]` on `Bc2Message` if live API returns root message attachments (for Task 5). |
| `tests/unit/bc2-attachment-download.test.ts` | **Create** — Mock `fetch`, assert auth headers, 401 retry without auth, success body. |
| `tests/unit/migrate-bc2-comment-attachments.test.ts` | **Create** — Test a thin `importBc2AttachmentIfNeeded`-style function with injected deps **or** integration-style test of the helper only (no full DB). |

---

### Task 1: `downloadBc2Attachment` helper + unit tests

**Files:**

- Create: `lib/imports/bc2-attachment-download.ts`
- Create: `tests/unit/bc2-attachment-download.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBc2Attachment } from "@/lib/imports/bc2-attachment-download";

describe("downloadBc2Attachment", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it("retries without Authorization when first response is 403", async () => {
    const url = "https://basecamp.example.com/attachments/1/download";
    const authed = new Response(null, { status: 403 });
    const ok = new Response(new Uint8Array([1, 2, 3]), { status: 200 });

    vi.mocked(fetch)
      .mockResolvedValueOnce(authed)
      .mockResolvedValueOnce(ok);

    const buf = await downloadBc2Attachment(url, {
      username: "user",
      password: "pass",
      userAgent: "TestAgent/1"
    });

    expect(Buffer.from(new Uint8Array(buf)).equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(first.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Basic /),
      "User-Agent": "TestAgent/1"
    });
    const second = vi.mocked(fetch).mock.calls[1]![1];
    expect(second).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd basecamp-clone && npx vitest run tests/unit/bc2-attachment-download.test.ts`

Expected: FAIL (module or function missing).

- [ ] **Step 3: Implement minimal module**

Create `lib/imports/bc2-attachment-download.ts`:

```typescript
export type Bc2DownloadEnv = {
  username: string;
  password: string;
  userAgent: string;
};

const DEFAULT_BACKOFF_MS = [5000, 15000, 30000, 60000] as const;

/**
 * Download bytes from a BC2 attachment URL.
 * Tries HTTP Basic auth first; on 401/403 retries without Authorization (pre-signed URLs).
 * On 429, honors Retry-After or uses DEFAULT_BACKOFF_MS (same indices as migrate-bc2.ts).
 */
export async function downloadBc2Attachment(
  url: string,
  env: Bc2DownloadEnv,
  options?: { backoffMs?: readonly number[] }
): Promise<ArrayBuffer> {
  const backoffMs = options?.backoffMs ?? DEFAULT_BACKOFF_MS;
  const basic =
    "Basic " + Buffer.from(`${env.username}:${env.password}`).toString("base64");

  for (let dlAttempt = 0; dlAttempt <= backoffMs.length; dlAttempt++) {
    let res = await fetch(url, {
      headers: {
        Authorization: basic,
        "User-Agent": env.userAgent
      }
    });

    if (res.status === 401 || res.status === 403) {
      res = await fetch(url);
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : (backoffMs[dlAttempt] ?? backoffMs[backoffMs.length - 1]!);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!res.ok) {
      throw new Error(`Failed to download attachment: HTTP ${res.status}`);
    }

    return res.arrayBuffer();
  }

  throw new Error("Failed to download attachment: too many 429 retries");
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/bc2-attachment-download.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/imports/bc2-attachment-download.ts tests/unit/bc2-attachment-download.test.ts
git commit -m "feat(bc2): extract attachment download helper for migration reuse"
```

---

### Task 2: Shared `importMapHasFile` + `importBc2FileFromAttachment` used by `migrateFiles`

**Files:**

- Create: `lib/imports/bc2-migrate-single-file.ts` — single attachment → Dropbox + `createFileMetadata` + `import_map_files`, with optional `threadId` / `commentId`.
- Modify: `scripts/migrate-bc2.ts` — replace inlined download/upload block with calls to this helper (behavior unchanged for project-only files).

- [ ] **Step 1: Add unit test for early return when map exists**

Create `tests/unit/bc2-migrate-single-file.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { importBc2FileFromAttachment } from "@/lib/imports/bc2-migrate-single-file";

describe("importBc2FileFromAttachment", () => {
  it("returns existing local file id when import_map_files already has basecamp id", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ local_file_id: "already-local" }]
    });
    const result = await importBc2FileFromAttachment({
      query: query as any,
      jobId: "job-1",
      projectLocalId: "proj-1",
      storageDir: "/root/CODE/client-proj",
      personMap: new Map([[1, "profile-1"]]),
      attachment: {
        id: 99,
        name: "a.png",
        content_type: "image/png",
        byte_size: 3,
        url: "https://example.com/a",
        created_at: "",
        creator: { id: 1, name: "A" }
      },
      threadId: null,
      commentId: null,
      downloadEnv: { username: "u", password: "p", userAgent: "UA" },
      adapter: {} as any,
      createFileMetadata: vi.fn() as any,
      logRecord: vi.fn(),
      incrementCounters: vi.fn()
    });
    expect(result).toEqual({ status: "skipped_existing", localFileId: "already-local" });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
```

Run: `npx vitest run tests/unit/bc2-migrate-single-file.test.ts` — expect FAIL until helper exists.

- [ ] **Step 2: Implement `lib/imports/bc2-migrate-single-file.ts`**

Define a small `QueryFn` type matching `migrate-bc2.ts`’s `query<T>` pattern (or use generics). The helper should:

1. `select local_file_id from import_map_files where basecamp_file_id = $1` — if row, return `{ status: "skipped_existing", localFileId }`.
2. Else `downloadBc2Attachment` → `Buffer` → build `targetPath` like `${storageDir}/uploads/${Date.now()}-${id}-${safeFilename}`.
3. `adapter.uploadComplete({ ... })` same as script today.
4. `createFileMetadata({ projectId, uploaderUserId, filename, mimeType, sizeBytes, dropboxFileId, dropboxPath, checksum: "", threadId, commentId })`.
5. `insert into import_map_files ...`
6. Call `logRecord(jobId, "file", String(attachment.id), "success")` and `incrementCounters(jobId, 1, 0)`.
7. On failure after retries, delegate to caller or call `logRecord` / `incrementCounters` for failed — **YAGNI:** for the helper, throw or return `{ status: "failed" }`; let `migrate-bc2.ts` keep its retry loop wrapping **only** the bulk file phase if you want to avoid changing behavior. **Recommended:** implement retry loop **inside** the helper to match current `FILE_RETRY_ATTEMPTS` / `FILE_RETRY_DELAY_MS` so both call sites stay simple.

Export:

```typescript
export type ImportBc2FileResult =
  | { status: "imported"; localFileId: string }
  | { status: "skipped_existing"; localFileId: string }
  | { status: "failed"; error: string };
```

- [ ] **Step 3: Wire `migrateFiles` to the helper**

Replace the inner try body (idempotency through insert) with a call to `importBc2FileFromAttachment` with `threadId: null`, `commentId: null`. Preserve per-batch structure and outer progress counters; map `imported`/`skipped_existing` to `projectFileCount++` / `fileCount++`, `failed` to existing failure logging.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/bc2-migrate-single-file.test.ts tests/unit/bc2-attachment-download.test.ts`

Add one more test: when map empty, mock `downloadBc2Attachment`, adapter, `createFileMetadata`, assert `insert` SQL called.

- [ ] **Step 5: Commit**

```bash
git add lib/imports/bc2-migrate-single-file.ts scripts/migrate-bc2.ts tests/unit/bc2-migrate-single-file.test.ts
git commit -m "refactor(bc2): centralize single-attachment import for migrate-bc2"
```

---

### Task 3: Import comment attachments during `migrateThreadsAndComments`

**Files:**

- Modify: `scripts/migrate-bc2.ts`

- [ ] **Step 1: Extend function signature**

Change `migrateThreadsAndComments(..., mode: RunMode)` to also accept `includeFiles: boolean` (or full `CliFlags.files || CliFlags.onlyFiles`).

Update call site in `main()` to pass `flags.files || flags.onlyFiles`.

- [ ] **Step 2: Resolve local comment id for every comment**

Inside the comment loop, replace the branch that only creates when missing map with:

1. Query `import_map_comments` for `local_comment_id`.
2. If missing and not dry: `createComment`, insert map, log success.
3. If missing and dry: skip attachment import (no local id).
4. Set `localCommentId` from created or existing row.

- [ ] **Step 3: When `includeFiles && mode !== "dry"`**, loop `(comment.attachments ?? [])` and call `importBc2FileFromAttachment` with:

- `threadId: localThreadId`
- `commentId: localCommentId`
- Same `storageDir` as file phase: load project row via `getProjectStorageDir` — **cache per project** in the outer project loop (one `select` per project, not per comment) to avoid N+1 slowdown.

- [ ] **Step 4: Dry run**

Run: `npx tsx scripts/migrate-bc2.ts --mode=dry`

Expected: no DB file writes; thread/comment counts only.

- [ ] **Step 5: Run test suite**

Run: `npm run test` or at least `npx vitest run`

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-bc2.ts
git commit -m "feat(bc2): migrate comment attachments with thread/comment linkage"
```

---

### Task 4: Document CLI + manual verification

**Files:**

- Modify: `basecamp-clone/README.md` (only the section describing `migrate-bc2.ts`, if present) — **skip if no existing migrate section** per YAGNI; otherwise add one sentence: `--files` also imports per-comment attachments.

- [ ] **Step 1: Manual check**

After import, open a discussion that had BC2 comment attachments; confirm thumbnails/download match. Confirm project-wide file pass logs fewer new rows for duplicates.

- [ ] **Step 2: Commit** (if README changed)

```bash
git add README.md && git commit -m "docs: note BC2 comment attachment import with --files"
```

---

### Task 5 (optional): Message / thread-starter attachments

**Files:**

- Modify: `lib/imports/bc2-fetcher.ts` — add `attachments?: Bc2Attachment[]` to `Bc2Message` if a real API sample shows root-level attachments.
- Modify: `scripts/migrate-bc2.ts` — after thread is mapped, if `includeFiles`, loop `message.attachments ?? []` with `threadId: localThreadId`, `commentId: null`.

**Gap:** `getThread` in `lib/repositories.ts` only selects `project_files` where `comment_id is not null`, so starter attachments **will not** render on the discussion lead section until a follow-up changes `getThread`, the threads API route, and `app/[id]/[discussion]/page.tsx` to expose `thread.attachments`. Document that in this task if you implement import-only.

- [ ] **Step 1: Capture one real `GET .../messages/{id}.json`** (redact tokens) and confirm whether `attachments` exists on the root message object.
- [ ] **Step 2:** If yes, implement import with `commentId: null` and either file a separate UI plan or extend `getThread` + discussion page in the same change.

---

## Self-review

1. **Spec coverage:** Comment attachments (`createFileMetadata` + `import_map_files` dedupe + order vs `migrateFiles`) → Tasks 2–3. Thread starter → Task 5 optional. User preference “single row” → Task 2 idempotency + Task 3 ordering.
2. **Placeholders:** None intentional; Task 5 depends on real API shape.
3. **Consistency:** `downloadBc2Attachment` returns `ArrayBuffer`; `migrate-bc2` can `Buffer.from(...)`. `importBc2FileFromAttachment` should use the same env vars as the script today (`BASECAMP_USERNAME`, etc.) passed from `main`.

---

## Execution handoff

**Plan complete and saved to** `basecamp-clone/docs/superpowers/plans/closed/2026-03-31-bc2-comment-attachments-migration.md`.

**Two execution options:**

1. **Subagent-driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. **Required sub-skill:** superpowers:subagent-driven-development.

2. **Inline execution** — Run tasks in one session with checkpoints. **Required sub-skill:** superpowers:executing-plans.

**Which approach do you want?**
