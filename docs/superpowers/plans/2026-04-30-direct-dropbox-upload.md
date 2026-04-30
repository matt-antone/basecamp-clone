# Direct-to-Dropbox Upload Bypass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Vercel Blob transit-storage upload bypass (live on `main` from PR #19, but built for the wrong platform) with a direct browser → Dropbox upload using Dropbox's Temporary Upload Link, eliminating transit storage and the Netlify Functions 6 MB body cap.

**Architecture:** The browser hits a small JSON `/upload-init` route which returns a Dropbox-issued one-shot upload URL. The browser PUTs the file bytes directly to Dropbox (CORS-enabled, single PUT up to 150 MB). On success, the browser captures the Dropbox file id from the PUT response and posts it to `/upload-complete`, which calls `filesGetMetadata` keyed by id, asserts the resulting `path_display` is inside the project's storage prefix, and inserts the row in one shot. Zero transit storage, zero `after()`, no `transfer_status` lifecycle. Spec: `docs/superpowers/specs/2026-04-30-direct-dropbox-upload-design.md`.

**Tech Stack:** Next.js App Router (Route Handlers), TypeScript, Vitest, `dropbox` JS SDK, Supabase Postgres, pnpm.

---

### Task 1: Branch setup

**Files:** none modified — git only.

- [ ] **Step 1: Confirm current branch and repo state**

Run: `git status` and `git log --oneline main..HEAD`
Expected: clean tree; current branch ahead of `main` only by trivial commits + the spec doc commit (`0f91ba2`).

- [ ] **Step 2: Cut a new branch from current `main`**

```bash
git fetch origin
git checkout -b fix/direct-dropbox-upload origin/main
```

- [ ] **Step 3: Cherry-pick the spec doc onto the new branch**

```bash
git cherry-pick 0f91ba2
```

Expected: clean cherry-pick (only adds `docs/superpowers/specs/2026-04-30-direct-dropbox-upload-design.md`).

- [ ] **Step 4: Verify clean state**

Run: `git status && pnpm install --frozen-lockfile`
Expected: clean tree; install succeeds.

---

### Task 2: Write idempotent revert migration

**Files:**
- Create: `supabase/migrations/0025_revert_project_files_transfer_status.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Reverts 0023_project_files_transfer_status.sql.
-- Direct-to-Dropbox upload pattern (no transit storage) eliminates the need for a
-- transfer lifecycle on project_files. Idempotent so it runs cleanly whether or not
-- 0023 has been applied to the target environment.

drop index if exists project_files_status_idx;

alter table project_files drop column if exists status;
alter table project_files drop column if exists transfer_error;
alter table project_files drop column if exists blob_url;

-- Restore NOT NULL constraints relaxed by 0023. Rows in flight under the
-- now-removed lifecycle would be 'pending' / 'in_progress' with NULL Dropbox columns;
-- the steps below assume those rows have either completed (status='ready' before
-- the column drop) or been manually cleaned. If any rows still have NULL Dropbox
-- columns, the SET NOT NULL will fail loudly — investigate before re-running.

alter table project_files alter column dropbox_file_id set not null;
alter table project_files alter column dropbox_path set not null;
alter table project_files alter column checksum set not null;
```

- [ ] **Step 2: Apply migration locally**

Run: `pnpm supabase migration up` (or the equivalent project command — match the existing repo's migration runner script).
Expected: migration succeeds; `\d project_files` shows the three columns gone and Dropbox columns NOT NULL.

- [ ] **Step 3: Verify schema**

```bash
pnpm supabase db remote query "select column_name, is_nullable from information_schema.columns where table_name='project_files' and column_name in ('status','transfer_error','blob_url','dropbox_file_id','dropbox_path','checksum') order by column_name"
```
Expected: only `checksum`, `dropbox_file_id`, `dropbox_path` returned; all `is_nullable=NO`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0025_revert_project_files_transfer_status.sql
git commit -m "feat(db): revert project_files transfer status columns

Direct-to-Dropbox upload pattern eliminates transit storage and the
transfer-status lifecycle. Idempotent revert of 0023."
```

---

### Task 3: Drop `@vercel/blob` dep, `BLOB_READ_WRITE_TOKEN`, `.env.example`

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` (regenerated)
- Modify: `lib/config-core.ts` (delete `blobReadWriteToken` getter)
- Modify: `.env.example`

- [ ] **Step 1: Remove the dep**

```bash
pnpm remove @vercel/blob
```
Expected: `package.json` no longer lists `@vercel/blob`; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Delete the `blobReadWriteToken` getter in `lib/config-core.ts`**

Find this block (around lines 151–156):

```ts
  blobReadWriteToken: () => {
    const value = getOptionalEnv("BLOB_READ_WRITE_TOKEN");
    if (!value) {
      throw new Error("BLOB_READ_WRITE_TOKEN is required for file uploads");
    }
    return value;
  },
```

Delete it. The surrounding object literal (other config getters) stays as-is.

- [ ] **Step 3: Remove `BLOB_READ_WRITE_TOKEN` from `.env.example`**

Open `.env.example`. Delete the line:

```
BLOB_READ_WRITE_TOKEN=
```

…and the comment line directly above it referring to Vercel Blob (if present).

- [ ] **Step 4: Confirm no remaining references**

Run:
```bash
grep -rE 'BLOB_READ_WRITE_TOKEN|blobReadWriteToken|@vercel/blob' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.mjs' --include='*.js' .
```
Expected: only matches inside `docs/superpowers/plans/2026-04-29-blob-upload-bypass.md` (historical) and the new spec/plan markdown. **Zero matches in TS/JS/JSON.**

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml lib/config-core.ts .env.example
git commit -m "chore: drop @vercel/blob dep and BLOB_READ_WRITE_TOKEN wiring

Direct-to-Dropbox upload removes the need for Vercel Blob transit storage."
```

---

### Task 4: Extend `DropboxStorageAdapter` with `getTemporaryUploadLink` + `getFileMetadata`

**Files:**
- Modify: `lib/storage/dropbox-adapter.ts`
- Test: `tests/unit/dropbox-adapter.test.ts` (extend if exists; create if not — match existing test scaffolding pattern)

- [ ] **Step 1: Write the failing test for `getTemporaryUploadLink`**

In `tests/unit/dropbox-adapter.test.ts` add:

```ts
import { describe, expect, it, vi } from "vitest";

describe("DropboxStorageAdapter.getTemporaryUploadLink", () => {
  it("calls SDK with the expected commit_info and returns the link", async () => {
    const filesGetTemporaryUploadLink = vi.fn().mockResolvedValue({
      result: { link: "https://content.dropboxapi.com/apitul/x/abc" }
    });
    const fakeClient = { filesGetTemporaryUploadLink, usersGetCurrentAccount: vi.fn().mockResolvedValue({
      result: { root_info: { root_namespace_id: "1", home_namespace_id: "1" } }
    }) };

    const { DropboxStorageAdapter } = await import("@/lib/storage/dropbox-adapter");
    const adapter = new DropboxStorageAdapter();
    // @ts-expect-error – inject fake client for the test
    adapter.baseClient = fakeClient;

    const result = await adapter.getTemporaryUploadLink({
      targetPath: "/Projects/ACME/ACME-0001-Brief/uploads/cover.jpg"
    });

    expect(filesGetTemporaryUploadLink).toHaveBeenCalledWith({
      commit_info: {
        path: "/Projects/ACME/ACME-0001-Brief/uploads/cover.jpg",
        mode: { ".tag": "add" },
        autorename: true,
        mute: true
      },
      duration: 14400
    });
    expect(result).toEqual({ uploadUrl: "https://content.dropboxapi.com/apitul/x/abc" });
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm vitest run tests/unit/dropbox-adapter.test.ts -t getTemporaryUploadLink`
Expected: FAIL — `adapter.getTemporaryUploadLink is not a function`.

- [ ] **Step 3: Add the method to `lib/storage/dropbox-adapter.ts`**

Inside the `DropboxStorageAdapter` class body (near the other public methods), add:

```ts
async getTemporaryUploadLink(args: { targetPath: string }): Promise<{ uploadUrl: string }> {
  const client = await this.getClient();
  const response = await client.filesGetTemporaryUploadLink({
    commit_info: {
      path: args.targetPath,
      mode: { ".tag": "add" },
      autorename: true,
      mute: true
    },
    duration: 14400 // 4 hours, the documented Dropbox max for this endpoint
  });
  return { uploadUrl: response.result.link };
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `pnpm vitest run tests/unit/dropbox-adapter.test.ts -t getTemporaryUploadLink`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `getFileMetadata`**

Append to the same test file:

```ts
describe("DropboxStorageAdapter.getFileMetadata", () => {
  it("looks up by id: prefix and returns normalized fields", async () => {
    const filesGetMetadata = vi.fn().mockResolvedValue({
      result: {
        ".tag": "file",
        id: "id:abc123",
        path_display: "/Projects/ACME/ACME-0001-Brief/uploads/cover.jpg",
        content_hash: "deadbeef",
        size: 1234,
        server_modified: "2026-04-30T17:00:00Z"
      }
    });
    const fakeClient = { filesGetMetadata, usersGetCurrentAccount: vi.fn().mockResolvedValue({
      result: { root_info: { root_namespace_id: "1", home_namespace_id: "1" } }
    }) };

    const { DropboxStorageAdapter } = await import("@/lib/storage/dropbox-adapter");
    const adapter = new DropboxStorageAdapter();
    // @ts-expect-error
    adapter.baseClient = fakeClient;

    const result = await adapter.getFileMetadata({ dropboxFileId: "id:abc123" });

    expect(filesGetMetadata).toHaveBeenCalledWith({ path: "id:abc123" });
    expect(result).toEqual({
      fileId: "id:abc123",
      pathDisplay: "/Projects/ACME/ACME-0001-Brief/uploads/cover.jpg",
      contentHash: "deadbeef",
      size: 1234,
      serverModified: "2026-04-30T17:00:00Z"
    });
  });

  it("throws when Dropbox returns a non-file metadata entry", async () => {
    const filesGetMetadata = vi.fn().mockResolvedValue({
      result: { ".tag": "folder", id: "id:xyz", path_display: "/Projects/foo" }
    });
    const fakeClient = { filesGetMetadata, usersGetCurrentAccount: vi.fn().mockResolvedValue({
      result: { root_info: { root_namespace_id: "1", home_namespace_id: "1" } }
    }) };

    const { DropboxStorageAdapter } = await import("@/lib/storage/dropbox-adapter");
    const adapter = new DropboxStorageAdapter();
    // @ts-expect-error
    adapter.baseClient = fakeClient;

    await expect(adapter.getFileMetadata({ dropboxFileId: "id:xyz" })).rejects.toThrow(/not a file/);
  });
});
```

- [ ] **Step 6: Run — expect failure**

Run: `pnpm vitest run tests/unit/dropbox-adapter.test.ts -t getFileMetadata`
Expected: FAIL.

- [ ] **Step 7: Implement `getFileMetadata`**

Add to the same class body:

```ts
async getFileMetadata(args: { dropboxFileId: string }): Promise<{
  fileId: string;
  pathDisplay: string;
  contentHash: string;
  size: number;
  serverModified: string;
}> {
  const client = await this.getClient();
  const response = await client.filesGetMetadata({ path: args.dropboxFileId });
  const entry = response.result as {
    ".tag": string;
    id?: string;
    path_display?: string;
    content_hash?: string;
    size?: number;
    server_modified?: string;
  };
  if (entry[".tag"] !== "file") {
    throw new Error(`Dropbox metadata for ${args.dropboxFileId} is not a file (got .tag=${entry[".tag"]})`);
  }
  if (!entry.id || !entry.path_display || !entry.content_hash || typeof entry.size !== "number" || !entry.server_modified) {
    throw new Error(`Dropbox metadata for ${args.dropboxFileId} is missing required fields`);
  }
  return {
    fileId: entry.id,
    pathDisplay: entry.path_display,
    contentHash: entry.content_hash,
    size: entry.size,
    serverModified: entry.server_modified
  };
}
```

- [ ] **Step 8: Run — expect pass**

Run: `pnpm vitest run tests/unit/dropbox-adapter.test.ts`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/storage/dropbox-adapter.ts tests/unit/dropbox-adapter.test.ts
git commit -m "feat(storage): add getTemporaryUploadLink + getFileMetadata to Dropbox adapter

These power the direct-to-Dropbox upload bypass: server mints a one-shot
upload URL, client PUTs file bytes directly, server then verifies via
metadata lookup keyed by Dropbox file id."
```

---

### Task 5: Simplify `createFileMetadata`, drop transfer-status helpers

**Files:**
- Modify: `lib/repositories.ts`
- Test: `tests/unit/repositories-create-file-metadata.test.ts` (create or extend)

- [ ] **Step 1: Write the failing test for the simplified `createFileMetadata`**

Add a new test (or extend an existing repositories test file):

```ts
import { describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({ query: queryMock }));
vi.mock("@/lib/repositories/touch-project-activity", () => ({
  touchProjectActivity: vi.fn().mockResolvedValue(undefined)
})); // adjust path to match repo's actual touch helper location

describe("createFileMetadata (post-revert)", () => {
  it("inserts row without status/blob_url and returns the new row", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{
      id: "row-1", project_id: "p", uploader_user_id: "u",
      filename: "x.jpg", mime_type: "image/jpeg", size_bytes: 100,
      dropbox_file_id: "id:abc", dropbox_path: "/Projects/.../x.jpg",
      checksum: "deadbeef", created_at: "2026-04-30T17:00:00Z"
    }] });
    queryMock.mockResolvedValueOnce({ rows: [] }); // touchProjectActivity inner

    const { createFileMetadata } = await import("@/lib/repositories");
    const row = await createFileMetadata({
      projectId: "p", uploaderUserId: "u",
      filename: "x.jpg", mimeType: "image/jpeg", sizeBytes: 100,
      dropboxFileId: "id:abc", dropboxPath: "/Projects/.../x.jpg",
      checksum: "deadbeef"
    });

    expect(row?.id).toBe("row-1");
    const sql = queryMock.mock.calls[0]?.[0] ?? "";
    expect(sql).not.toMatch(/status|blob_url|transfer_error/);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run tests/unit/repositories-create-file-metadata.test.ts`
Expected: FAIL — current `createFileMetadata` requires `status` and `blobUrl`.

- [ ] **Step 3: Simplify `createFileMetadata` in `lib/repositories.ts`**

Replace the entire `createFileMetadata` body (the args type, values array, and the primary `insert` SQL — the legacy fallback inserts that swallow `isMissingProjectFileColumnError` already exclude `status`/`blob_url`, but the primary insert references them). The new function:

```ts
export async function createFileMetadata(args: {
  projectId: string;
  uploaderUserId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  dropboxFileId: string;
  dropboxPath: string;
  checksum: string;
  threadId?: string | null;
  commentId?: string | null;
  thumbnailUrl?: string | null;
  bcAttachmentId?: string | null;
  sourceCreatedAt?: Date | null;
}) {
  const sourceTs = args.sourceCreatedAt ?? null;
  const bcId = args.bcAttachmentId ?? null;
  const values = [
    args.projectId,
    args.uploaderUserId,
    args.filename,
    args.mimeType,
    args.sizeBytes,
    args.dropboxFileId,
    args.dropboxPath,
    args.checksum,
    args.threadId ?? null,
    args.commentId ?? null,
    args.thumbnailUrl ?? null,
    bcId,
    sourceTs
  ];

  try {
    const result = await query(
      `insert into project_files (
        project_id, uploader_user_id, filename, mime_type, size_bytes,
        dropbox_file_id, dropbox_path, checksum,
        thread_id, comment_id, thumbnail_url, bc_attachment_id, created_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, coalesce($13::timestamptz, now()))
       returning *`,
      values
    );
    const file = result.rows[0] ? normalizeProjectFileSizeRow(result.rows[0]) : null;
    await touchProjectActivity(args.projectId, args.sourceCreatedAt ?? undefined);
    return file;
  } catch (error) {
    if (!isMissingProjectFileColumnError(error)) {
      throw error;
    }

    if (args.threadId || args.commentId) {
      throw new Error("Comment attachments require database migration 0007_comment_attachments.sql");
    }

    const result = await query(
      `insert into project_files (
        project_id, uploader_user_id, filename, mime_type, size_bytes,
        dropbox_file_id, dropbox_path, checksum, created_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()))
       returning *`,
      [...values.slice(0, 8), sourceTs]
    );
    const file = result.rows[0] ? normalizeProjectFileSizeRow(result.rows[0]) : null;
    await touchProjectActivity(args.projectId, args.sourceCreatedAt ?? undefined);
    return file;
  }
}
```

Note: `dropboxFileId`, `dropboxPath`, and `checksum` are now **required (non-nullable)** because direct-to-Dropbox guarantees these are known when the row is created. Callers that previously passed `null` (BC2 importers) need to be updated — handled in Task 11.

- [ ] **Step 4: Delete the three transfer-lifecycle helpers**

In the same file, locate and delete entirely:
- `markFileTransferInProgress` (around line 1569)
- `finalizeFileMetadataAfterTransfer` (around line 1578)
- `markFileTransferFailed` (around line 1597)

- [ ] **Step 5: Run the new test — expect pass**

Run: `pnpm vitest run tests/unit/repositories-create-file-metadata.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full repositories test suite**

Run: `pnpm vitest run tests/unit/repositories`
Expected: All PASS. If any tests reference the deleted helpers, delete those tests (they belong to the abandoned transfer-status flow).

- [ ] **Step 7: Commit**

```bash
git add lib/repositories.ts tests/unit/repositories-create-file-metadata.test.ts
git commit -m "refactor(repositories): drop transfer-status helpers, require Dropbox fields on createFileMetadata

Direct-to-Dropbox writes the row only after the bytes have landed in
Dropbox, so dropbox_file_id/dropbox_path/checksum are always known."
```

---

### Task 6: Rewrite `/upload-init` route

**Files:**
- Modify: `app/projects/[id]/files/upload-init/route.ts`
- Test: `tests/unit/upload-init-route.test.ts` (rewrite)

- [ ] **Step 1: Replace `tests/unit/upload-init-route.test.ts` with new tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const assertClientNotArchivedForMutationMock = vi.fn();
const getProjectStorageDirMock = vi.fn();
const getTemporaryUploadLinkMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  assertClientNotArchivedForMutation: assertClientNotArchivedForMutationMock
}));
vi.mock("@/lib/project-storage", () => ({
  getProjectStorageDir: getProjectStorageDirMock
}));
vi.mock("@/lib/storage/dropbox-adapter", () => ({
  DropboxStorageAdapter: class {
    getTemporaryUploadLink = getTemporaryUploadLinkMock;
  }
}));

const PROJECT = { id: "project-1", client_id: "11111111-1111-1111-8111-111111111111" };
const STORAGE_DIR = "/Projects/ACME/ACME-0001-Brief";

function makeRequest(body: unknown) {
  return new Request("http://localhost/projects/project-1/files/upload-init", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /projects/[id]/files/upload-init", () => {
  beforeEach(() => {
    vi.resetModules();
    [requireUserMock, getProjectMock, assertClientNotArchivedForMutationMock, getProjectStorageDirMock, getTemporaryUploadLinkMock]
      .forEach((m) => m.mockReset());
    getProjectStorageDirMock.mockReturnValue(STORAGE_DIR);
  });

  it("returns 200 with uploadUrl, targetPath, requestId for a valid request", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1" });
    getProjectMock.mockResolvedValue(PROJECT);
    assertClientNotArchivedForMutationMock.mockResolvedValue(undefined);
    getTemporaryUploadLinkMock.mockResolvedValue({ uploadUrl: "https://content.dropboxapi.com/apitul/x/abc" });

    const { POST } = await import("@/app/projects/[id]/files/upload-init/route");
    const res = await POST(
      makeRequest({ filename: "cover.jpg", mimeType: "image/jpeg", sizeBytes: 1234 }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.uploadUrl).toBe("https://content.dropboxapi.com/apitul/x/abc");
    expect(json.targetPath).toBe(`${STORAGE_DIR}/uploads/cover.jpg`);
    expect(typeof json.requestId).toBe("string");
    expect(getTemporaryUploadLinkMock).toHaveBeenCalledWith({
      targetPath: `${STORAGE_DIR}/uploads/cover.jpg`
    });
  });

  it("returns 401 when requireUser throws", async () => {
    requireUserMock.mockRejectedValue(new Error("Missing auth token"));
    const { POST } = await import("@/app/projects/[id]/files/upload-init/route");
    const res = await POST(makeRequest({ filename: "x.jpg", mimeType: "image/jpeg", sizeBytes: 1 }), { params: Promise.resolve({ id: "project-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the project does not exist", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1" });
    getProjectMock.mockResolvedValue(null);
    const { POST } = await import("@/app/projects/[id]/files/upload-init/route");
    const res = await POST(makeRequest({ filename: "x.jpg", mimeType: "image/jpeg", sizeBytes: 1 }), { params: Promise.resolve({ id: "project-1" }) });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the client is archived", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1" });
    getProjectMock.mockResolvedValue(PROJECT);
    assertClientNotArchivedForMutationMock.mockRejectedValue(new Error("Client is archived. Restore it before uploading files."));
    const { POST } = await import("@/app/projects/[id]/files/upload-init/route");
    const res = await POST(makeRequest({ filename: "x.jpg", mimeType: "image/jpeg", sizeBytes: 1 }), { params: Promise.resolve({ id: "project-1" }) });
    expect(res.status).toBe(409);
  });

  it("returns 400 for missing fields", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1" });
    getProjectMock.mockResolvedValue(PROJECT);
    assertClientNotArchivedForMutationMock.mockResolvedValue(undefined);
    const { POST } = await import("@/app/projects/[id]/files/upload-init/route");
    const res = await POST(makeRequest({ filename: "" }), { params: Promise.resolve({ id: "project-1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when sizeBytes exceeds the 150 MB ceiling", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1" });
    getProjectMock.mockResolvedValue(PROJECT);
    assertClientNotArchivedForMutationMock.mockResolvedValue(undefined);
    const { POST } = await import("@/app/projects/[id]/files/upload-init/route");
    const res = await POST(
      makeRequest({ filename: "x.bin", mimeType: "application/octet-stream", sizeBytes: 150 * 1024 * 1024 + 1 }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(400);
    expect(getTemporaryUploadLinkMock).not.toHaveBeenCalled();
  });

  it("returns 500 when Dropbox throws", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1" });
    getProjectMock.mockResolvedValue(PROJECT);
    assertClientNotArchivedForMutationMock.mockResolvedValue(undefined);
    getTemporaryUploadLinkMock.mockRejectedValue(new Error("dropbox down"));
    const { POST } = await import("@/app/projects/[id]/files/upload-init/route");
    const res = await POST(
      makeRequest({ filename: "x.jpg", mimeType: "image/jpeg", sizeBytes: 1 }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run tests/unit/upload-init-route.test.ts`
Expected: FAIL — current route uses `handleUpload` and rejects the new body schema.

- [ ] **Step 3: Replace the route handler**

Overwrite `app/projects/[id]/files/upload-init/route.ts` with:

```ts
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { badRequest, conflict, notFound, serverError, unauthorized } from "@/lib/http";
import { assertClientNotArchivedForMutation, getProject } from "@/lib/repositories";
import { getProjectStorageDir } from "@/lib/project-storage";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

const initSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES)
});

const CLIENT_MUTATION_BLOCK_PATTERN = /client is archived|client archive is in progress/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request);
    const { id: projectId } = await params;

    const project = await getProject(projectId);
    if (!project) {
      return notFound("Project not found");
    }

    await assertClientNotArchivedForMutation(project.client_id, {
      archived: "Client is archived. Restore it before uploading files.",
      inProgress: "Client archive is in progress. File uploads are temporarily disabled."
    });

    const body = await request.json().catch(() => null);
    const parsed = initSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.message);
    }

    const targetPath = `${getProjectStorageDir(project)}/uploads/${parsed.data.filename}`;
    const adapter = new DropboxStorageAdapter();
    const { uploadUrl } = await adapter.getTemporaryUploadLink({ targetPath });

    return Response.json({
      uploadUrl,
      targetPath,
      requestId: randomUUID()
    });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof Error && CLIENT_MUTATION_BLOCK_PATTERN.test(error.message)) {
      return conflict(error.message);
    }
    console.error("upload_init_failed", { error });
    return serverError();
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm vitest run tests/unit/upload-init-route.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/projects/[id]/files/upload-init/route.ts tests/unit/upload-init-route.test.ts
git commit -m "feat(upload-init): mint Dropbox temporary upload link instead of Vercel Blob token

Server validates auth/project/archive guards, computes targetPath under
getProjectStorageDir(project)/uploads, and returns a Dropbox-issued
one-shot upload URL plus a requestId for log correlation."
```

---

### Task 7: Rewrite `/upload-complete` route

**Files:**
- Modify: `app/projects/[id]/files/upload-complete/route.ts`
- Test: `tests/unit/upload-complete-route.test.ts` (rewrite)

- [ ] **Step 1: Rewrite `tests/unit/upload-complete-route.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const assertClientNotArchivedForMutationMock = vi.fn();
const getThreadMock = vi.fn();
const getCommentMock = vi.fn();
const createFileMetadataMock = vi.fn();
const enqueueThumbnailJobAndNotifyBestEffortMock = vi.fn();
const getProjectStorageDirMock = vi.fn();
const getFileMetadataMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/repositories", () => ({
  assertClientNotArchivedForMutation: assertClientNotArchivedForMutationMock,
  createFileMetadata: createFileMetadataMock,
  getComment: getCommentMock,
  getProject: getProjectMock,
  getThread: getThreadMock
}));
vi.mock("@/lib/thumbnail-enqueue-after-save", () => ({
  enqueueThumbnailJobAndNotifyBestEffort: enqueueThumbnailJobAndNotifyBestEffortMock
}));
vi.mock("@/lib/project-storage", () => ({
  getProjectStorageDir: getProjectStorageDirMock
}));
vi.mock("@/lib/storage/dropbox-adapter", () => ({
  DropboxStorageAdapter: class {
    getFileMetadata = getFileMetadataMock;
  }
}));

const PROJECT = { id: "project-1", client_id: "11111111-1111-1111-8111-111111111111" };
const STORAGE_DIR = "/Projects/ACME/ACME-0001-Brief";

function makeRequest(body: unknown) {
  return new Request("http://localhost/projects/project-1/files/upload-complete", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("POST /projects/[id]/files/upload-complete", () => {
  beforeEach(() => {
    vi.resetModules();
    [requireUserMock, getProjectMock, assertClientNotArchivedForMutationMock, getThreadMock, getCommentMock,
      createFileMetadataMock, enqueueThumbnailJobAndNotifyBestEffortMock, getProjectStorageDirMock, getFileMetadataMock]
      .forEach((m) => m.mockReset());
    getProjectStorageDirMock.mockReturnValue(STORAGE_DIR);
    requireUserMock.mockResolvedValue({ id: "user-1" });
    getProjectMock.mockResolvedValue(PROJECT);
    assertClientNotArchivedForMutationMock.mockResolvedValue(undefined);
  });

  it("creates the row and returns it on success", async () => {
    getFileMetadataMock.mockResolvedValue({
      fileId: "id:abc", pathDisplay: `${STORAGE_DIR}/uploads/cover.jpg`,
      contentHash: "deadbeef", size: 1234, serverModified: "2026-04-30T17:00:00Z"
    });
    createFileMetadataMock.mockResolvedValue({ id: "row-1", filename: "cover.jpg" });

    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(
      makeRequest({ dropboxFileId: "id:abc", requestId: "req-1" }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.file.id).toBe("row-1");
    expect(createFileMetadataMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      uploaderUserId: "user-1",
      filename: "cover.jpg",
      dropboxFileId: "id:abc",
      dropboxPath: `${STORAGE_DIR}/uploads/cover.jpg`,
      checksum: "deadbeef",
      sizeBytes: 1234
    }));
    expect(enqueueThumbnailJobAndNotifyBestEffortMock).toHaveBeenCalled();
  });

  it("validates threadId and commentId together for comment attachments", async () => {
    getThreadMock.mockResolvedValue({ id: "thread-1" });
    getCommentMock.mockResolvedValue({ id: "comment-1" });
    getFileMetadataMock.mockResolvedValue({
      fileId: "id:abc", pathDisplay: `${STORAGE_DIR}/uploads/x.jpg`,
      contentHash: "h", size: 1, serverModified: "2026-04-30T17:00:00Z"
    });
    createFileMetadataMock.mockResolvedValue({ id: "row-1" });

    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(
      makeRequest({ dropboxFileId: "id:abc", requestId: "r", threadId: "11111111-1111-1111-8111-111111111111", commentId: "22222222-2222-2222-8222-222222222222" }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(200);
    expect(createFileMetadataMock).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "11111111-1111-1111-8111-111111111111",
      commentId: "22222222-2222-2222-8222-222222222222"
    }));
  });

  it("returns 400 when commentId is given without threadId", async () => {
    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(
      makeRequest({ dropboxFileId: "id:abc", requestId: "r", commentId: "22222222-2222-2222-8222-222222222222" }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when path_display is outside the project storage prefix", async () => {
    getFileMetadataMock.mockResolvedValue({
      fileId: "id:abc", pathDisplay: "/Projects/OTHER_CLIENT/uploads/leak.jpg",
      contentHash: "h", size: 1, serverModified: "2026-04-30T17:00:00Z"
    });
    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(
      makeRequest({ dropboxFileId: "id:abc", requestId: "r" }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(403);
    expect(createFileMetadataMock).not.toHaveBeenCalled();
  });

  it("maps Dropbox path_not_found to 404", async () => {
    getFileMetadataMock.mockRejectedValue(Object.assign(new Error("path_not_found"), { status: 409 }));
    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(
      makeRequest({ dropboxFileId: "id:nope", requestId: "r" }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 when requireUser throws", async () => {
    requireUserMock.mockRejectedValue(new Error("Missing auth token"));
    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(makeRequest({ dropboxFileId: "id:abc", requestId: "r" }), { params: Promise.resolve({ id: "project-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 409 when the client is archived", async () => {
    assertClientNotArchivedForMutationMock.mockRejectedValue(new Error("Client is archived. Restore it before uploading files."));
    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(makeRequest({ dropboxFileId: "id:abc", requestId: "r" }), { params: Promise.resolve({ id: "project-1" }) });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `pnpm vitest run tests/unit/upload-complete-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Replace `app/projects/[id]/files/upload-complete/route.ts`**

```ts
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  assertClientNotArchivedForMutation,
  createFileMetadata,
  getComment,
  getProject,
  getThread
} from "@/lib/repositories";
import { enqueueThumbnailJobAndNotifyBestEffort } from "@/lib/thumbnail-enqueue-after-save";
import { badRequest, conflict, forbidden, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { getProjectStorageDir } from "@/lib/project-storage";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";

const completeSchema = z.object({
  dropboxFileId: z.string().min(1).max(256),
  requestId: z.string().min(1).max(128),
  threadId: z.string().uuid().optional(),
  commentId: z.string().uuid().optional()
}).superRefine((value, ctx) => {
  if (value.commentId && !value.threadId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "commentId requires threadId"
    });
  }
});

const CLIENT_MUTATION_BLOCK_PATTERN = /client is archived|client archive is in progress/i;
const DROPBOX_PATH_NOT_FOUND_PATTERN = /path_not_found|not_found|path\/not_found/i;

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id: projectId } = await params;

    const project = await getProject(projectId);
    if (!project) {
      return notFound("Project not found");
    }

    await assertClientNotArchivedForMutation(project.client_id, {
      archived: "Client is archived. Restore it before uploading files.",
      inProgress: "Client archive is in progress. File uploads are temporarily disabled."
    });

    const body = await request.json().catch(() => null);
    const parsed = completeSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.message);
    }
    const payload = parsed.data;

    if (payload.threadId) {
      const thread = await getThread(projectId, payload.threadId);
      if (!thread) {
        return notFound("Thread not found");
      }
    }
    if (payload.commentId && payload.threadId) {
      const comment = await getComment(projectId, payload.threadId, payload.commentId);
      if (!comment) {
        return notFound("Comment not found");
      }
    }

    const adapter = new DropboxStorageAdapter();
    let metadata;
    try {
      metadata = await adapter.getFileMetadata({ dropboxFileId: payload.dropboxFileId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (DROPBOX_PATH_NOT_FOUND_PATTERN.test(message)) {
        return notFound("Uploaded file not found in Dropbox");
      }
      throw error;
    }

    const expectedPrefix = `${getProjectStorageDir(project)}/uploads/`;
    if (!metadata.pathDisplay.startsWith(expectedPrefix)) {
      console.warn("upload_complete_path_attribution_blocked", {
        projectId,
        dropboxFileId: payload.dropboxFileId,
        pathDisplay: metadata.pathDisplay,
        expectedPrefix
      });
      return forbidden("Uploaded file is outside the project's storage area");
    }

    const file = await createFileMetadata({
      projectId,
      uploaderUserId: user.id,
      filename: basename(metadata.pathDisplay),
      mimeType: request.headers.get("x-original-mime-type") ?? "application/octet-stream",
      sizeBytes: metadata.size,
      dropboxFileId: metadata.fileId,
      dropboxPath: metadata.pathDisplay,
      checksum: metadata.contentHash,
      threadId: payload.threadId ?? null,
      commentId: payload.commentId ?? null
    });

    if (!file) {
      return serverError("Failed to persist file metadata");
    }

    await enqueueThumbnailJobAndNotifyBestEffort({
      projectId,
      fileRecord: file as unknown as Record<string, unknown>,
      requestId: payload.requestId,
      projectArchived: Boolean(project.archived)
    });

    return ok({ file });
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof Error && CLIENT_MUTATION_BLOCK_PATTERN.test(error.message)) {
      return conflict(error.message);
    }
    console.error("upload_complete_failed", { error });
    return serverError(error instanceof Error ? error.message : "Upload failed");
  }
}
```

> The `mimeType` is read from a request header rather than the body so the route accepts only id-keyed metadata in the JSON. This keeps the contract narrow. The browser must send `x-original-mime-type: <file.type>`. If the header is missing the row stores `application/octet-stream`, which is a known acceptable default for downstream consumers.

- [ ] **Step 4: Verify `forbidden` helper exists in `@/lib/http`**

Run: `grep -n "export function forbidden" lib/http.ts`
Expected: at least one match. If not, add it next to the existing helpers (e.g. `notFound`/`badRequest`):

```ts
export function forbidden(message = "Forbidden") {
  return Response.json({ error: message }, { status: 403 });
}
```

(Skip if it already exists.)

- [ ] **Step 5: Run tests — expect pass**

Run: `pnpm vitest run tests/unit/upload-complete-route.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add app/projects/[id]/files/upload-complete/route.ts tests/unit/upload-complete-route.test.ts lib/http.ts
git commit -m "feat(upload-complete): finalize via Dropbox metadata lookup

Switches to id-keyed lookup (handles autorename), enforces
path_display prefix matching the project's storage dir to prevent
cross-project attribution, and creates the row in one synchronous
shot — no after(), no transit fetch, no transfer-status lifecycle."
```

---

### Task 8: Update project page upload flow (`app/[id]/page.tsx`)

**Files:**
- Modify: `app/[id]/page.tsx`

- [ ] **Step 1: Remove the `@vercel/blob/client` import**

Find:

```ts
import { upload } from "@vercel/blob/client";
```

Delete that line.

- [ ] **Step 2: Replace the `uploadSelectedFile` function body**

Locate the function (currently around line 455). Replace its body with:

```ts
async function uploadSelectedFile() {
  if (!token || !projectId || !selectedFile) return;
  setIsUploading(true);
  try {
    // 1. Mint a Dropbox temporary upload link.
    const initRes = await authedJsonFetch(token, `/projects/${projectId}/files/upload-init`, {
      method: "POST",
      body: JSON.stringify({
        filename: selectedFile.name,
        mimeType: selectedFile.type || "application/octet-stream",
        sizeBytes: selectedFile.size
      })
    });
    if (!initRes.ok) {
      throw new Error(`upload-init failed (${initRes.status})`);
    }
    const { uploadUrl, requestId } = (await initRes.json()) as { uploadUrl: string; requestId: string };

    // 2. PUT bytes directly to Dropbox via XHR (Fetch lacks upload-progress events).
    const dropboxMetadata = await new Promise<{ id: string; path_display: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", uploadUrl); // Dropbox temp upload link is POST, not PUT
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setUploadProgress(event.loaded / event.total);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            reject(new Error("Dropbox PUT response was not JSON"));
          }
        } else {
          reject(new Error(`Dropbox upload failed (${xhr.status}): ${xhr.responseText}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error uploading to Dropbox"));
      xhr.send(selectedFile);
    });

    // 3. Tell the server to finalize via metadata lookup.
    await authedFetch(token, `/projects/${projectId}/files/upload-complete`, {
      method: "POST",
      headers: { "x-original-mime-type": selectedFile.type || "application/octet-stream" },
      body: JSON.stringify({
        dropboxFileId: dropboxMetadata.id,
        requestId
      })
    });

    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await refreshFiles();
  } catch (err) {
    console.error("upload_failed", err);
    setUploadError(err instanceof Error ? err.message : "Upload failed");
  } finally {
    setIsUploading(false);
    setUploadProgress(0);
  }
}
```

If the existing component doesn't already have an `uploadProgress` state, add `const [uploadProgress, setUploadProgress] = useState(0);` next to the other upload-related state declarations and surface it in the existing progress UI (or whatever loading indicator the component already shows).

> **Dropbox temp upload link uses POST, not PUT.** Per the Dropbox HTTP docs the `link` returned by `/2/files/get_temporary_upload_link` accepts `POST` with the file body. Verify by checking the working sample on the Dropbox docs page before merging.

- [ ] **Step 3: Remove `transfer_error` from the local `ProjectFile`-like type**

If a local type definition in this file declares `transfer_error: string | null;` on line ~80, remove that field. Also remove any `pending`/`in_progress` literal string types from the `status` field's union — leaving only `'ready' | 'failed'` if the field still exists on the local type, or removing the field entirely if `status` came in only via the transfer flow.

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors in `app/[id]/page.tsx`.

- [ ] **Step 5: Commit**

```bash
git add 'app/[id]/page.tsx'
git commit -m "feat(uploads): browser project files panel uses Dropbox temp upload link

Three-step flow: /upload-init → XHR POST to Dropbox → /upload-complete
with the Dropbox file id from the PUT response. Drives the existing
progress UI from the XHR upload-progress event."
```

---

### Task 9: Update discussion comment-attachment upload flow (`app/[id]/[discussion]/page.tsx`)

**Files:**
- Modify: `app/[id]/[discussion]/page.tsx`

- [ ] **Step 1: Remove the `@vercel/blob/client` import**

Find:

```ts
import { upload } from "@vercel/blob/client";
```

Delete that line.

- [ ] **Step 2: Replace the upload helper body**

Locate the upload helper function (currently around lines 478–520; the function takes `{ token, onToken, projectId, threadId, commentId, file, onUploadProgress }`). Replace the body with the same three-step flow, mapping XHR progress to the existing `0.1–0.9` band the function already uses:

```ts
async function uploadCommentAttachment(args: {
  token: string;
  onToken: (token: string) => void;
  projectId: string;
  threadId: string;
  commentId: string;
  file: File;
  onUploadProgress: (fraction: number) => void;
}) {
  const { token, onToken, projectId, threadId, commentId, file, onUploadProgress } = args;
  const resolvedToken = await ensureAccessToken(token, onToken);

  onUploadProgress(0.1);

  // 1. Mint upload link.
  const initRes = await authedJsonFetch(resolvedToken, `/projects/${projectId}/files/upload-init`, {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size
    })
  });
  if (!initRes.ok) {
    throw new Error(`upload-init failed (${initRes.status})`);
  }
  const { uploadUrl, requestId } = (await initRes.json()) as { uploadUrl: string; requestId: string };

  // 2. POST bytes directly to Dropbox.
  const dropboxMetadata = await new Promise<{ id: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const dropboxFraction = event.loaded / event.total;
        // Map 0–100% Dropbox upload to 10–90% of the overall progress.
        onUploadProgress(Math.max(0.1, Math.min(0.9, 0.1 + dropboxFraction * 0.8)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { reject(new Error("Dropbox response was not JSON")); }
      } else {
        reject(new Error(`Dropbox upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error uploading to Dropbox"));
    xhr.send(file);
  });

  onUploadProgress(0.9);

  // 3. Finalize.
  await authedJsonFetch(resolvedToken, `/projects/${projectId}/files/upload-complete`, {
    method: "POST",
    headers: { "x-original-mime-type": file.type || "application/octet-stream" },
    body: JSON.stringify({
      dropboxFileId: dropboxMetadata.id,
      requestId,
      threadId,
      commentId
    })
  });

  onUploadProgress(1);
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors in this file.

- [ ] **Step 4: Commit**

```bash
git add 'app/[id]/[discussion]/page.tsx'
git commit -m "feat(uploads): discussion comment attachments use Dropbox temp upload link

Same three-step flow as the project files panel; preserves the
0.1–0.9 progress band the existing UI uses."
```

---

### Task 10: Drop transient-status UI from `project-files-panel.tsx`

**Files:**
- Modify: `components/projects/project-files-panel.tsx`

- [ ] **Step 1: Trim the `ProjectFile` type**

Find:

```ts
type ProjectFile = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  thumbnail_url?: string | null;
  created_at: string;
  status: "pending" | "in_progress" | "ready" | "failed";
  transfer_error: string | null;
};
```

Replace with:

```ts
type ProjectFile = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  thumbnail_url?: string | null;
  created_at: string;
};
```

- [ ] **Step 2: Remove `isPending` / `isFailed` branches**

In the file list render (currently around lines 130–200), find the line:

```ts
const isPending = file.status === "pending" || file.status === "in_progress";
const isFailed = file.status === "failed";
```

Delete both. Then delete every JSX branch that uses `isPending` or `isFailed` (placeholder spinner, `fileStatusFailed` span at ~line 196, the `transfer_error` `title` on the wrapper at ~line 165). Replace each branch with the existing "ready" rendering — since rows now never appear in any other state, the conditional collapses to the ready path.

- [ ] **Step 3: Type-check + tests**

Run: `pnpm tsc --noEmit && pnpm vitest run components/projects`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/projects/project-files-panel.tsx
git commit -m "refactor(ui): drop transient transfer-status branches from project files panel

Direct-to-Dropbox writes the row only after bytes are in Dropbox, so
the panel only ever renders ready files."
```

---

### Task 11: Remove `blobUrl` from BC2 importers

**Files:**
- Modify: `lib/imports/bc2-migrate-single-file.ts`
- Modify: `lib/imports/basecamp2-import.ts`

- [ ] **Step 1: Update `lib/imports/bc2-migrate-single-file.ts`**

Locate the `createFileMetadata` call (around line 159). Remove the `status: "ready"` and `blobUrl: null` properties from the args object — these are not part of the new `createFileMetadata` signature. Keep `dropboxFileId`, `dropboxPath`, and `checksum` (all required now); the importer was already passing concrete values.

If the importer was passing `null` for any of `dropboxFileId`/`dropboxPath`/`checksum`, that's a pre-existing bug exposed by the new non-null contract. Investigate the importer's source data and supply real values; if it has none, the importer must skip the row rather than insert with NULLs.

- [ ] **Step 2: Update `lib/imports/basecamp2-import.ts`**

Same change at line 268. Remove `status: "ready"` and `blobUrl: null` from the args object.

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Run import-related tests**

Run: `pnpm vitest run tests/unit/imports`
Expected: clean. Update any test fixtures that supply `status`/`blobUrl` to drop those keys.

- [ ] **Step 5: Commit**

```bash
git add lib/imports/bc2-migrate-single-file.ts lib/imports/basecamp2-import.ts
git commit -m "refactor(imports): drop status/blobUrl from BC2 createFileMetadata calls

The transfer-status fields were dropped with the Vercel Blob revert."
```

---

### Task 12: Remove `blobUrl` from `project-activity-touch.test.ts`

**Files:**
- Modify: `tests/unit/project-activity-touch.test.ts`

- [ ] **Step 1: Edit the fixture**

At line 133, find `blobUrl: null` and the `status: "ready"` (likely on the line above or below). Remove both keys from the `createFileMetadata` args fixture.

- [ ] **Step 2: Run the suite**

Run: `pnpm vitest run tests/unit/project-activity-touch.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/project-activity-touch.test.ts
git commit -m "test: drop status/blobUrl from project-activity-touch fixture"
```

---

### Task 13: Verification gate (must all pass before opening PR)

**Files:** none modified.

- [ ] **Step 1: Type-check**

Run: `pnpm tsc --noEmit`
Expected: zero errors.

- [ ] **Step 2: Full test run**

Run: `pnpm vitest run`
Expected: all green.

- [ ] **Step 3: Dead-code scan**

Run: `pnpm fallow dead-code`
Expected: zero unreachable exports introduced or left behind by this refactor. If any pre-existing dead code is reported, document it (it's not blocking) but make sure nothing new is on the list.

- [ ] **Step 4: Vercel-Blob residue scan**

Run:

```bash
grep -rE '@vercel/blob|blob_url|blobUrl|transfer_status|transfer_error|markFileTransfer|finalizeFileMetadataAfterTransfer|BLOB_READ_WRITE_TOKEN|blobReadWriteToken' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.sql' --include='*.mjs' --include='*.js' .
```

Expected matches (allow-list):

- `docs/superpowers/plans/2026-04-29-blob-upload-bypass.md` (historical)
- `docs/superpowers/specs/2026-04-30-direct-dropbox-upload-design.md` (mentions in Background, dead-code list)
- `docs/superpowers/plans/2026-04-30-direct-dropbox-upload.md` (this plan)
- `supabase/migrations/0023_project_files_transfer_status.sql` (preserved history)
- `supabase/migrations/0025_revert_project_files_transfer_status.sql` (the revert)

Anything else: stop, fix, repeat.

- [ ] **Step 5: Manual smoke checklist (against Netlify preview deploy)**

0. **Pre-deploy:** Confirm the production-environment SQL probe `select count(*) from project_files where dropbox_file_id is null or dropbox_path is null or checksum is null` returns `0`. If non-zero, follow the cleanup runbook in the spec ("Pre-deploy operational checklist") before applying migration `0025`.

Push the branch, let Netlify build a preview, then exercise:

1. Pick an 8 MB iStock JPG → file appears in the project files list with thumbnail.
2. Pick a 30 MB PDF → appears.
3. Pick a 200 MB file → client-side rejection (size guard) before `/upload-init`.
4. DevTools throttle to slow 3G mid-upload → progress bar updates smoothly; the upload succeeds at the end.
5. Temporarily set an invalid Dropbox refresh token in env → `/upload-init` 5xx surfaces in toast.
6. Upload the same filename twice → second persists as `name (1).ext` (autorename); list shows the autorenamed name.
7. Comment-attachment flow on a discussion → file linked to the comment, visible in the thread.

- [ ] **Step 6: Open PR**

```bash
git push -u origin fix/direct-dropbox-upload
gh pr create --title "fix(uploads): direct-to-Dropbox bypass (replaces Vercel Blob)" --body "$(cat <<'EOF'
## Summary
- Replaces the Vercel Blob transit-storage flow shipped via PR #19. The old plan assumed a Vercel deploy; production runs on Netlify.
- Browser PUTs file bytes directly to a Dropbox-issued temporary upload URL. No transit storage, no Netlify body cap, no new vendor.
- Reverts migration 0023 (transfer_status / transfer_error / blob_url) via 0025; drops `@vercel/blob` dep; cleans every related call site.
- Adds path-display prefix guard in /upload-complete to block cross-project attribution.

Spec: docs/superpowers/specs/2026-04-30-direct-dropbox-upload-design.md
Plan: docs/superpowers/plans/2026-04-30-direct-dropbox-upload.md

## Test plan
- [ ] CI: pnpm tsc --noEmit
- [ ] CI: pnpm vitest run
- [ ] CI: pnpm fallow dead-code
- [ ] Smoke: 8 MB iStock JPG uploads and lists with thumbnail
- [ ] Smoke: 30 MB PDF uploads and lists
- [ ] Smoke: 200 MB file rejected pre-upload (client-side size guard)
- [ ] Smoke: comment attachment flow on a discussion
- [ ] Smoke: same filename twice — autorenamed by Dropbox

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens; CI runs; reviewers can verify.

---

## Files summary

**Created:**
- `supabase/migrations/0025_revert_project_files_transfer_status.sql`
- `tests/unit/dropbox-adapter.test.ts` (if not already present — extend if it is)
- `tests/unit/repositories-create-file-metadata.test.ts` (if not already present — extend if it is)

**Modified:**
- `package.json`, `pnpm-lock.yaml`, `.env.example`
- `lib/config-core.ts`
- `lib/storage/dropbox-adapter.ts`
- `lib/repositories.ts`
- `lib/http.ts` (only if `forbidden` helper is missing)
- `lib/imports/bc2-migrate-single-file.ts`
- `lib/imports/basecamp2-import.ts`
- `app/projects/[id]/files/upload-init/route.ts`
- `app/projects/[id]/files/upload-complete/route.ts`
- `app/[id]/page.tsx`
- `app/[id]/[discussion]/page.tsx`
- `components/projects/project-files-panel.tsx`
- `tests/unit/upload-init-route.test.ts`
- `tests/unit/upload-complete-route.test.ts`
- `tests/unit/project-activity-touch.test.ts`

**Untouched (preserved history):**
- `supabase/migrations/0023_project_files_transfer_status.sql`
- `docs/superpowers/plans/2026-04-29-blob-upload-bypass.md`
