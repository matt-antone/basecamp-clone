# File Upload Bypass via Vercel Blob — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Problem:** Vercel Functions enforce a hard 4.5 MB request body limit at the edge. Multipart-encoded image uploads >~4 MB to `/projects/[id]/files/upload-complete` are rejected with 413 *before* the route handler runs, so nothing reaches application logs. Users see "upload failed" with no diagnostic. Reported by client for iStock images <10 MB.

**Goal:** Eliminate the 4.5 MB ceiling on file uploads by routing file bytes through Vercel Blob (presigned client upload, direct browser → Blob, no body limit) instead of through the Next.js route. The route only ever receives a small JSON payload containing the blob URL. Server then fetches blob → uploads to Dropbox → records metadata → deletes blob. Async pattern with persistent status row so users see upload progress and failure reasons in the UI.

**Architecture:**

```
Browser:  pick file
  → POST /projects/[id]/files/upload-init    (auth, returns Blob client token)
  → upload(file, token)                       (presigned, browser → Blob direct)
  → POST /projects/[id]/files/upload-complete (small JSON: blobUrl + metadata)
                                              ↓
                                              creates project_files row, status='pending'
                                              returns 202 + file row
                                              after() runs in background:
                                                fetch(blobUrl) → adapter.uploadComplete()
                                                update row { status:'ready', dropbox_*, checksum }
                                                enqueueThumbnailJob (existing)
                                                del(blobUrl)
                                              after() catch:
                                                update row { status:'failed', transfer_error }
                                                del(blobUrl)

Browser: file appears immediately with spinner badge (status='pending'/'in_progress')
         polls or refreshes file list; row flips to 'ready' or 'failed'
```

**Why persistent row with status (not transfer-id polling):** matches existing `clients_archive_status` and thumbnail `status: 'ready'` patterns. `after()` + status column already proven in `lib/clients-archive-restore.ts:52-80` and `app/clients/[id]/archive/route.ts`. No new infrastructure. UI gets a real row to display so failure surfaces inline rather than as a transient toast that disappears on refresh.

**Why client-side Blob upload (not server proxy):** server proxy would still hit the 4.5 MB limit on the way in. `@vercel/blob/client.upload()` issues a presigned URL via the token endpoint and uploads directly browser → Blob storage, bypassing the function entirely for the bytes.

**Cost:** Blob storage ~$0.023/GB-mo, egress $0.05/GB. Files deleted immediately after Dropbox transfer succeeds → standing storage ≈ 0. Egress ~$0.05 per GB transferred (server fetch from blob counts). Negligible at expected volume.

**Tech Stack:** Next.js App Router, `@vercel/blob` (new dep), TypeScript, Vitest, Supabase Postgres.

**Out of scope:**
- Cron sweep for stuck `pending` rows (defer; failure path covers happy-path crashes).
- Retry queue for failed Dropbox transfers (user requested simple; row stays `failed`, user re-uploads).
- Migration of existing comment-attachment upload flow in `app/[id]/[discussion]/page.tsx` is **in scope** (Task 6) — same bug, same fix.
- Email notification on transfer failure (defer; status row in UI is sufficient signal).

---

### Task 1: Install `@vercel/blob` and add env wiring

**Files:**
- Modify: `package.json`
- Modify: `lib/config-core.ts` (or wherever env validation lives)
- Modify: `.env.example`

- [ ] **Step 1: Create branch from `main`**

```bash
git checkout main
git pull
git checkout -b fix/blob-upload-bypass
```

- [ ] **Step 2: Install dependency**

```bash
pnpm add @vercel/blob
```

- [ ] **Step 3: Add env var `BLOB_READ_WRITE_TOKEN`**

`BLOB_READ_WRITE_TOKEN` is auto-injected when a Blob store is connected to the Vercel project. Locally, pull via `vercel env pull`. Document in `.env.example`:

```
# Vercel Blob (transient storage for file upload bypass; auto-injected on Vercel)
BLOB_READ_WRITE_TOKEN=
```

Add a getter in `lib/config-core.ts` matching the existing `dropboxArchivedClientsRoot()` pattern. Use the `getOptionalEnv` helper (NOT bare `process.env`) — the file is shared across Node.js (Next.js) and Deno (Supabase Edge) and the helper preserves runtime compatibility:

```ts
blobReadWriteToken: () => {
  const value = getOptionalEnv("BLOB_READ_WRITE_TOKEN");
  if (!value) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required for file uploads");
  }
  return value;
},
```

- [ ] **Step 4: Provision Blob store in Vercel dashboard**

Manual step: in Vercel project → Storage → Create Blob Store → connect to project. This injects `BLOB_READ_WRITE_TOKEN` into all environments. Run `vercel env pull` locally to sync.

- [ ] **Step 5: Verify build passes**

Run: `pnpm exec tsc --noEmit`
Expected: no output (exit 0).

---

### Task 2: Add migration for `project_files` status columns

**Files:**
- Create: `supabase/migrations/0023_project_files_transfer_status.sql`

- [ ] **Step 1: Write migration**

```sql
-- Make Dropbox-derived columns nullable so a row can exist before transfer completes
alter table project_files alter column dropbox_file_id drop not null;
alter table project_files alter column dropbox_path drop not null;
alter table project_files alter column checksum drop not null;

-- Transfer lifecycle: 'pending' → 'in_progress' → 'ready' | 'failed'
-- Existing rows are 'ready' (already in Dropbox).
alter table project_files add column status text not null default 'ready';
alter table project_files add column transfer_error text;
alter table project_files add column blob_url text;

create index if not exists project_files_status_idx on project_files (status) where status <> 'ready';
```

- [ ] **Step 2: Apply migration locally**

```bash
supabase migrate
```

- [ ] **Step 3: Verify schema**

```bash
supabase db diff --schema public
```
Expected: empty (migration applied cleanly).

---

### Task 3: Repository updates for status + blob fields

**Files:**
- Modify: `lib/repositories.ts` (createFileMetadata, plus a new updater)
- Modify: `lib/storage/dropbox-adapter.ts` (mapDropboxMetadata return type)

- [ ] **Step 1: Extend `createFileMetadata` to accept `status`, `blobUrl`, and nullable Dropbox fields**

Find the existing `createFileMetadata` signature in `lib/repositories.ts` and widen the parameter type:

```ts
export async function createFileMetadata(args: {
  projectId: string;
  uploaderUserId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  dropboxFileId: string | null;
  dropboxPath: string | null;
  checksum: string | null;
  threadId: string | null;
  commentId: string | null;
  status: "pending" | "ready";
  blobUrl: string | null;
}) {
  // INSERT with all fields, return row
}
```

Existing call sites that pass non-null Dropbox fields (e.g. BC import) pass `status: "ready"` and `blobUrl: null`. New blob-flow call site passes `status: "pending"`, `dropboxFileId: null`, `dropboxPath: null`, `checksum: null`, `blobUrl: <url>`.

- [ ] **Step 2: Add `finalizeFileMetadataAfterTransfer`**

```ts
export async function finalizeFileMetadataAfterTransfer(args: {
  fileId: string;
  dropboxFileId: string;
  dropboxPath: string;
  checksum: string;
}) {
  // UPDATE project_files SET status='ready', dropbox_file_id=$2, dropbox_path=$3,
  //   checksum=$4, blob_url=NULL, transfer_error=NULL WHERE id=$1
}

export async function markFileTransferFailed(args: {
  fileId: string;
  error: string;
}) {
  // UPDATE project_files SET status='failed', transfer_error=$2, blob_url=NULL WHERE id=$1
}

export async function markFileTransferInProgress(fileId: string) {
  // UPDATE project_files SET status='in_progress' WHERE id=$1
}
```

- [ ] **Step 3: Update existing BC-import call sites**

Find every `createFileMetadata({...})` call (likely BC import + reconcile). Add `status: "ready"`, `blobUrl: null` to each. These rows already exist in Dropbox so `'ready'` is correct.

```bash
grep -rn 'createFileMetadata' --include='*.ts' .
```

Expected: 2-4 call sites in `app/` and `scripts/` or similar.

- [ ] **Step 4: tsc clean**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

---

### Task 4: Refactor `upload-init` to issue Blob client token

**Files:**
- Modify: `app/projects/[id]/files/upload-init/route.ts`

The existing route issues a Dropbox session id + target path. After this task it issues a Vercel Blob client upload token instead. Auth + archive checks stay; payload schema simplifies (no `sizeBytes`/`mimeType` needed — Blob handles).

- [ ] **Step 1: Replace handler**

```ts
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireUser } from "@/lib/auth";
import { badRequest, conflict, notFound, serverError, unauthorized } from "@/lib/http";
import { assertClientNotArchivedForMutation, getProject } from "@/lib/repositories";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const project = await getProject(id);
    if (!project) {
      return notFound("Project not found");
    }
    await assertClientNotArchivedForMutation(project.client_id, {
      archived: "Client is archived. Restore it before uploading files.",
      inProgress: "Client archive is in progress. File uploads are temporarily disabled."
    });

    const body = (await request.json()) as HandleUploadBody;

    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname /*, clientPayload */) => ({
        allowedContentTypes: undefined, // accept any
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ projectId: id, uploaderUserId: user.id, pathname })
      }),
      onUploadCompleted: async () => {
        // No-op: upload-complete handles persistence. handleUpload requires this callback.
      }
    });

    return Response.json(json);
  } catch (error) {
    if (error instanceof Error && /auth|token|workspace/i.test(error.message)) {
      return unauthorized(error.message);
    }
    if (error instanceof Error && /client is archived|client archive is in progress/i.test(error.message)) {
      return conflict(error.message);
    }
    if (error instanceof Error) {
      return badRequest(error.message);
    }
    return serverError();
  }
}
```

- [ ] **Step 2: Verify token endpoint shape**

`@vercel/blob/client.upload()` POSTs to this endpoint twice: once with `type: "blob.generate-client-token"`, once with `type: "blob.upload-completed"`. `handleUpload()` handles both. Auth check (`requireUser`) runs on both calls.

---

### Task 5: Refactor `upload-complete` to persist row + transfer in `after()`

**Files:**
- Modify: `app/projects/[id]/files/upload-complete/route.ts`

- [ ] **Step 1: Replace handler with JSON-only schema**

```ts
import { createHash, randomUUID } from "node:crypto";
import { after } from "next/server";
import { del } from "@vercel/blob";
import { requireUser } from "@/lib/auth";
import { enqueueThumbnailJobAndNotifyBestEffort } from "@/lib/thumbnail-enqueue-after-save";
import { badRequest, conflict, notFound, ok, serverError, unauthorized } from "@/lib/http";
import {
  assertClientNotArchivedForMutation,
  createFileMetadata,
  finalizeFileMetadataAfterTransfer,
  getComment,
  getProject,
  getThread,
  markFileTransferFailed,
  markFileTransferInProgress
} from "@/lib/repositories";
import {
  DropboxStorageAdapter,
  getDropboxErrorSummary,
  isTeamSelectUserRequiredError,
  mapDropboxMetadata
} from "@/lib/storage/dropbox-adapter";
import { z } from "zod";

const uploadCompleteSchema = z.object({
  blobUrl: z.string().url(),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  threadId: z.string().uuid().optional(),
  commentId: z.string().uuid().optional()
}).superRefine((value, ctx) => {
  if (value.commentId && !value.threadId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "threadId is required when commentId is provided",
      path: ["threadId"]
    });
  }
});

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

    const payload = uploadCompleteSchema.parse(await request.json());

    if (payload.threadId) {
      const thread = await getThread(projectId, payload.threadId);
      if (!thread) return notFound("Thread not found");
    }
    if (payload.commentId && payload.threadId) {
      const comment = await getComment(projectId, payload.threadId, payload.commentId);
      if (!comment) return notFound("Comment not found");
    }

    // Persist row immediately in 'pending' state so UI can show progress badge.
    const file = await createFileMetadata({
      projectId,
      uploaderUserId: user.id,
      filename: payload.filename,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
      dropboxFileId: null,
      dropboxPath: null,
      checksum: null,
      threadId: payload.threadId ?? null,
      commentId: payload.commentId ?? null,
      status: "pending",
      blobUrl: payload.blobUrl
    });
    if (!file) {
      throw new Error("Failed to create file metadata");
    }

    after(async () => {
      const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
      try {
        await markFileTransferInProgress(file.id);

        const blobResponse = await fetch(payload.blobUrl);
        if (!blobResponse.ok) {
          throw new Error(`Failed to fetch blob: ${blobResponse.status}`);
        }
        const content = Buffer.from(await blobResponse.arrayBuffer());
        const checksum = createHash("sha256").update(content).digest("hex");

        const adapter = new DropboxStorageAdapter();
        const projectStorageDir = await adapter.getProjectStorageDir(project); // or use existing helper
        const safeFilename = payload.filename; // adapter sanitizes internally
        const targetPath = `${projectStorageDir}/uploads/${safeFilename}`;

        const completed = await adapter.uploadComplete({
          sessionId: randomUUID(),
          targetPath,
          filename: payload.filename,
          content,
          mimeType: payload.mimeType
        });

        await finalizeFileMetadataAfterTransfer({
          fileId: file.id,
          dropboxFileId: completed.fileId,
          dropboxPath: completed.path,
          checksum
        });

        if (!project.archived) {
          const refreshed = await mapDropboxMetadata({
            projectId,
            uploaderUserId: user.id,
            filename: payload.filename,
            mimeType: payload.mimeType,
            sizeBytes: payload.sizeBytes,
            checksum,
            dropboxFileId: completed.fileId,
            dropboxPath: completed.path
          });
          await enqueueThumbnailJobAndNotifyBestEffort({
            projectId,
            fileRecord: { ...file, ...refreshed } as Record<string, unknown>,
            requestId
          });
        }
      } catch (error) {
        const summary = getDropboxErrorSummary(error);
        await markFileTransferFailed({ fileId: file.id, error: summary });
        console.error("upload_transfer_failed", { fileId: file.id, requestId, summary, error });
      } finally {
        // Delete blob whether success or failure — we only needed it as a transit buffer.
        try {
          await del(payload.blobUrl);
        } catch (cleanupError) {
          console.error("blob_cleanup_failed", { blobUrl: payload.blobUrl, cleanupError });
        }
      }
    });

    return ok({ file }, 202);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return badRequest(error.message);
    }
    if (isTeamSelectUserRequiredError(error)) {
      return serverError("Dropbox team token requires DROPBOX_SELECT_USER (team member id) or DROPBOX_SELECT_ADMIN.");
    }
    const summary = getDropboxErrorSummary(error);
    if (/auth|token|workspace|invalid_access_token|expired_access_token|invalid_grant|not_authed|missing_scope/i.test(summary)) {
      return unauthorized(summary);
    }
    if (error instanceof Error && /client is archived|client archive is in progress/i.test(error.message)) {
      return conflict(error.message);
    }
    return serverError(summary || (error instanceof Error ? error.message : "Upload failed"));
  }
}
```

- [ ] **Step 2: Confirm `getProjectStorageDir` is callable from this code path**

The existing route used `getProjectStorageDir(project)` synchronously from `lib/project-storage`. Match that — don't add an adapter method if one isn't needed.

- [ ] **Step 3: tsc clean**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

---

### Task 6: Update browser upload code (project files panel + discussion attachments)

**Files:**
- Modify: `app/[id]/page.tsx` (`uploadSelectedFile`, ~line 443)
- Modify: `app/[id]/[discussion]/page.tsx` (comment attachment upload flow)
- Modify: `lib/browser-auth.ts` (may add `authedJsonFetch` already exists; reuse)

- [ ] **Step 1: Replace `uploadSelectedFile` in `app/[id]/page.tsx`**

```tsx
import { upload } from "@vercel/blob/client";

async function uploadSelectedFile() {
  if (!token || !projectId || !selectedFile) return;
  setIsUploading(true);
  try {
    // 1. Direct browser → Blob (presigned, no 4.5 MB limit).
    const blob = await upload(selectedFile.name, selectedFile, {
      access: "public", // Blob requires this; URL is unguessable + short-lived in our usage
      handleUploadUrl: `/projects/${projectId}/files/upload-init`,
      // pass auth header through fetch; @vercel/blob/client supports this via clientPayload+headers in newer versions,
      // or wrap upload() with a custom fetcher. Verify current SDK API.
      headers: { Authorization: `Bearer ${token}` }
    });

    // 2. Tell server to start the transfer.
    await authedFetch(token, `/projects/${projectId}/files/upload-complete`, {
      method: "POST",
      body: JSON.stringify({
        blobUrl: blob.url,
        filename: selectedFile.name,
        sizeBytes: selectedFile.size,
        mimeType: selectedFile.type || "application/octet-stream"
      })
    });

    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await load(token, projectId);
    setStatus(`Uploading ${selectedFile.name} — will appear when transfer completes.`);
  } finally {
    setIsUploading(false);
  }
}
```

**Note on Blob client auth header:** `@vercel/blob/client.upload()` accepts `clientPayload` and supports custom headers via the `fetch` overrides; verify exact API in installed version (`pnpm view @vercel/blob`). If header injection is awkward, wrap with a manual two-call pattern (`fetch handleUploadUrl → presigned URL → PUT to Blob`) — the SDK source documents this fallback.

- [ ] **Step 2: Mirror change in `app/[id]/[discussion]/page.tsx`**

Replace the `postFormDataWithUploadProgress` call site with the same `upload() → POST upload-complete` two-step. Pass `threadId`/`commentId` in the JSON body, not as form fields.

- [ ] **Step 3: Add `status` rendering to file list UI**

Find the project files panel component (`components/projects/project-files-panel.tsx`). For each file row, branch on `status`:

- `pending` / `in_progress`: show spinner + label "Transferring to Dropbox…"; disable download/thumbnail.
- `ready`: existing render path.
- `failed`: show error icon + tooltip with `transfer_error`; offer "Re-upload" action that POSTs `/files/{id}` DELETE then prompts user to retry. (Or simpler: just show "Failed" badge — user re-uploads from scratch.)

Add `status: "pending" | "in_progress" | "ready" | "failed"` and `transfer_error: string | null` to the `ProjectFile` type in `app/[id]/page.tsx`.

- [ ] **Step 4: Optional polling for in-flight transfers**

Simplest: rely on `load(token, projectId)` already being called after upload + on user navigation. If a `pending` row is visible, schedule a single `setTimeout(load, 5000)` to refresh once. Avoid aggressive polling.

- [ ] **Step 5: Manual smoke test**

```bash
pnpm dev
```
- Upload a 1 KB text file → row appears `pending` → flips to `ready` within ~3s → file downloadable.
- Upload a 9 MB iStock JPEG → row appears `pending` → flips to `ready` → file downloadable. **This is the bug fix.**
- Upload a file while artificially breaking Dropbox auth (e.g. revoke `BLOB_READ_WRITE_TOKEN` mid-flight, or temporarily wrong DROPBOX_REFRESH_TOKEN) → row flips to `failed` with error tooltip.

---

### Task 7: Tests

**Files:**
- Create: `tests/unit/upload-complete-route.test.ts`
- Modify: existing upload tests if any

- [ ] **Step 1: Unit-test `upload-complete` happy path**

Mock `@vercel/blob` `del()`, mock `DropboxStorageAdapter`, mock `next/server` `after` to invoke the callback synchronously. Assert:
- 202 returned with file row in `pending` status.
- `createFileMetadata` called with `status: "pending"`, `blobUrl: <provided>`, dropbox fields null.
- After callback runs: `markFileTransferInProgress` → `adapter.uploadComplete` → `finalizeFileMetadataAfterTransfer` → `del(blobUrl)`.

- [ ] **Step 2: Unit-test failure path**

Mock `adapter.uploadComplete` to throw. Assert:
- `markFileTransferFailed` called with the error summary.
- `del(blobUrl)` still called.
- 202 still returned to client (failure is async).

- [ ] **Step 3: Run full test suite**

```bash
pnpm test
pnpm exec tsc --noEmit
```
Expected: all green.

---

### Task 8: Deploy + verify in production

- [ ] **Step 1: Provision Blob store in production project**

Vercel dashboard → project → Storage → Create Blob Store → connect. Confirms `BLOB_READ_WRITE_TOKEN` injected into Production env.

- [ ] **Step 2: Deploy via PR merge**

Standard flow. Run migration via Supabase before merging the deploy.

- [ ] **Step 3: Verify with the original reporting user**

Ask the reporter to re-attempt the upload that failed. Watch:
- Network tab: `/upload-init` → 200 with token, then PUT to `*.blob.vercel-storage.com` → 200, then `/upload-complete` → 202.
- File appears in UI with spinner → flips to ready within 5–10s.
- File downloadable.

- [ ] **Step 4: Monitor `upload_transfer_failed` log entries for 24h**

Vercel logs → filter `upload_transfer_failed`. Should be ~0 in normal operation. If non-zero, inspect `summary` field — likely Dropbox auth or filename collision issues, both pre-existing.
