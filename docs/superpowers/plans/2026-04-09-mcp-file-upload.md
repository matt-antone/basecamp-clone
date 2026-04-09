# MCP File Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three MCP tools (`upload_start`, `upload_chunk`, `upload_finish`) that allow agents to upload files to Dropbox and register them in `project_files` via a chunked base64 protocol.

**Architecture:** Chunked upload state lives in a new `upload_sessions` Supabase table (6h TTL). Each chunk is base64-decoded and forwarded to an active Dropbox upload session via the Dropbox SDK. On finish, the completed Dropbox file is registered in `project_files` using the existing `db.createFile` pattern. Path resolution is handled by a new `upload-helpers.ts` module that ports the core logic from `lib/project-storage.ts` without importing Next.js-dependent modules.

**Tech Stack:** Deno/TypeScript, Dropbox SDK (`npm:dropbox`, already in `deno.json`), Supabase PostgREST client, Vitest, Zod

**Branch:** `worktree-mcp-file-download-clients`

**Test command:** `cd "/Volumes/External/Glyphix Dropbox/Development Files/Under Development/Project Manager/basecamp-clone" && TMPDIR=/tmp/codex-vitest npx vitest run <file>`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/0025_upload_sessions.sql` | upload_sessions schema |
| Modify | `supabase/functions/basecamp-mcp/dropbox.ts` | 3 Dropbox SDK upload session functions |
| Create | `supabase/functions/basecamp-mcp/upload-helpers.ts` | Path resolution (port of lib/project-storage.ts) |
| Modify | `supabase/functions/basecamp-mcp/db.ts` | 5 upload session CRUD + getProjectForUpload |
| Modify | `supabase/functions/basecamp-mcp/tools.ts` | upload_start, upload_chunk, upload_finish tools |
| Modify | `tests/unit/mcp-dropbox.test.ts` | Tests for 3 new Dropbox upload session functions |
| Create | `tests/unit/mcp-upload-tools.test.ts` | Tests for the 3 upload tools |
| Modify | `tests/integration/mcp-smoke.test.ts` | Update tool count 18 → 21 |

---

## Task 1: Migration — upload_sessions table

**Files:**
- Create: `supabase/migrations/0025_upload_sessions.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0025_upload_sessions.sql
create table upload_sessions (
  id                  uuid primary key default gen_random_uuid(),
  client_id           text not null,
  project_id          uuid not null references projects(id),
  dropbox_session_id  text not null,
  target_path         text not null,
  filename            text not null,
  mime_type           text not null,
  total_bytes         bigint not null,
  offset              bigint not null default 0,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null
);

create index upload_sessions_expires_at_idx on upload_sessions(expires_at);
create index upload_sessions_client_id_idx on upload_sessions(client_id);
```

- [ ] **Step 2: Verify the file exists**

```bash
cat supabase/migrations/0025_upload_sessions.sql
```

Expected: SQL content printed without error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0025_upload_sessions.sql
git commit -m "feat(db): add upload_sessions table for MCP chunked uploads"
```

---

## Task 2: Dropbox upload session functions

**Files:**
- Modify: `supabase/functions/basecamp-mcp/dropbox.ts`
- Modify: `tests/unit/mcp-dropbox.test.ts`

- [ ] **Step 1: Extend the mock in mcp-dropbox.test.ts**

In `tests/unit/mcp-dropbox.test.ts`, add three new mock function declarations alongside the existing ones (after `const mockUsersGetCurrentAccount = vi.fn();`):

```typescript
const mockFilesUploadSessionStart = vi.fn();
const mockFilesUploadSessionAppendV2 = vi.fn();
const mockFilesUploadSessionFinish = vi.fn();
```

Then update `MockDropbox.mockImplementation` to include the three new methods:

```typescript
const MockDropbox = vi.fn().mockImplementation(() => ({
  filesDownload: mockFilesDownload,
  filesGetTemporaryLink: mockFilesGetTemporaryLink,
  usersGetCurrentAccount: mockUsersGetCurrentAccount,
  filesUploadSessionStart: mockFilesUploadSessionStart,
  filesUploadSessionAppendV2: mockFilesUploadSessionAppendV2,
  filesUploadSessionFinish: mockFilesUploadSessionFinish,
}));
```

- [ ] **Step 2: Write failing tests — append to mcp-dropbox.test.ts**

```typescript
describe("startUploadSession", () => {
  it("returns Dropbox session_id", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    mockFilesUploadSessionStart.mockResolvedValue({
      result: { session_id: "dbx-sess-abc123" },
    });

    const sessionId = await dropbox.startUploadSession();

    expect(sessionId).toBe("dbx-sess-abc123");
    expect(mockFilesUploadSessionStart).toHaveBeenCalledWith({
      close: false,
      contents: expect.any(Uint8Array),
    });
  });

  it("throws on SDK failure", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    mockFilesUploadSessionStart.mockRejectedValue({
      status: 500,
      error: { error_summary: "internal_server_error/" },
    });

    await expect(dropbox.startUploadSession()).rejects.toThrow();
  });
});

describe("appendUploadChunk", () => {
  it("calls filesUploadSessionAppendV2 with correct cursor and bytes", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    mockFilesUploadSessionAppendV2.mockResolvedValue({ result: {} });

    const bytes = new Uint8Array([1, 2, 3]);
    await dropbox.appendUploadChunk("dbx-sess-abc123", 0, bytes);

    expect(mockFilesUploadSessionAppendV2).toHaveBeenCalledWith({
      cursor: { session_id: "dbx-sess-abc123", offset: 0 },
      close: false,
      contents: bytes,
    });
  });
});

describe("finishUploadSession", () => {
  it("returns file metadata", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    mockFilesUploadSessionFinish.mockResolvedValue({
      result: {
        id: "id:XJWabcABCABC123",
        path_display: "/projects/acme/ACME-0001-Website/uploads/1234-report.csv",
        size: 5242880,
      },
    });

    const meta = await dropbox.finishUploadSession(
      "dbx-sess-abc123",
      5242880,
      "/projects/acme/ACME-0001-Website/uploads/1234-report.csv"
    );

    expect(meta.id).toBe("id:XJWabcABCABC123");
    expect(meta.path_display).toBe("/projects/acme/ACME-0001-Website/uploads/1234-report.csv");
    expect(meta.size).toBe(5242880);
    expect(mockFilesUploadSessionFinish).toHaveBeenCalledWith({
      cursor: { session_id: "dbx-sess-abc123", offset: 5242880 },
      commit: {
        path: "/projects/acme/ACME-0001-Website/uploads/1234-report.csv",
        mode: { ".tag": "add" },
        autorename: true,
        mute: false,
      },
    });
  });
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-dropbox.test.ts
```

Expected: FAIL — `dropbox.startUploadSession is not a function`

- [ ] **Step 4: Add three functions to dropbox.ts**

Append at the end of `supabase/functions/basecamp-mcp/dropbox.ts`:

```typescript
export async function startUploadSession(): Promise<string> {
  try {
    const client = await getClient();
    const result = await client.filesUploadSessionStart({
      close: false,
      contents: new Uint8Array(0),
    });
    return result.result.session_id;
  } catch (e: any) {
    throw classifyError(e);
  }
}

export async function appendUploadChunk(
  sessionId: string,
  offset: number,
  bytes: Uint8Array
): Promise<void> {
  try {
    const client = await getClient();
    await client.filesUploadSessionAppendV2({
      cursor: { session_id: sessionId, offset },
      close: false,
      contents: bytes,
    });
  } catch (e: any) {
    throw classifyError(e);
  }
}

export async function finishUploadSession(
  sessionId: string,
  offset: number,
  targetPath: string
): Promise<{ id: string; path_display: string; size: number }> {
  try {
    const client = await getClient();
    const result = await client.filesUploadSessionFinish({
      cursor: { session_id: sessionId, offset },
      commit: {
        path: targetPath,
        mode: { ".tag": "add" },
        autorename: true,
        mute: false,
      },
    });
    return {
      id: result.result.id,
      path_display: result.result.path_display ?? targetPath,
      size: result.result.size,
    };
  } catch (e: any) {
    throw classifyError(e);
  }
}
```

- [ ] **Step 5: Run to verify they pass**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-dropbox.test.ts
```

Expected: All tests PASS (existing + 5 new).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/basecamp-mcp/dropbox.ts tests/unit/mcp-dropbox.test.ts
git commit -m "feat(mcp): add Dropbox upload session functions (start/append/finish)"
```

---

## Task 3: Path resolution helper

**Files:**
- Create: `supabase/functions/basecamp-mcp/upload-helpers.ts`

This is a pure function module. No Deno or Supabase deps — safe to test trivially and import from tools.ts.

- [ ] **Step 1: Create upload-helpers.ts**

```typescript
// supabase/functions/basecamp-mcp/upload-helpers.ts

export type ProjectForUpload = {
  storage_project_dir: string | null;
  project_code: string | null;
  name: string;
  slug: string;
  archived: boolean;
  clients: { code: string; archived_at: string | null } | null;
};

function sanitizeTitle(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFilename(raw: string): string {
  return (
    raw
      .replace(/[^\w.\-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "file"
  );
}

/**
 * Port of lib/project-storage.ts#getProjectStorageDir for Deno edge functions.
 * Cannot import from lib/ — lib/config-core reads Next.js env vars unavailable in Deno.
 */
export function resolveProjectStorageDir(project: ProjectForUpload): string {
  if (project.storage_project_dir) return project.storage_project_dir;

  const clientCode = (
    project.clients?.code?.toUpperCase() ||
    (project.project_code ? project.project_code.replace(/-\d{4}$/, "") : "UNKNOWN")
  );
  const clientSlug = clientCode.toLowerCase();
  const folderName =
    project.project_code && /-\d{4}$/.test(project.project_code)
      ? `${project.project_code.toUpperCase()}-${sanitizeTitle(project.name || project.slug)}`
      : `${clientCode}-${clientSlug}-${project.slug}`;

  return `/projects/${clientSlug}/${folderName}`;
}

export function generateUploadTargetPath(storageDir: string, filename: string): string {
  const timestamp = Date.now();
  const sanitized = sanitizeFilename(filename);
  return `${storageDir}/uploads/${timestamp}-${sanitized}`;
}
```

- [ ] **Step 2: Verify the file**

```bash
cat supabase/functions/basecamp-mcp/upload-helpers.ts
```

Expected: File contents printed.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/basecamp-mcp/upload-helpers.ts
git commit -m "feat(mcp): add upload-helpers for project path resolution (port of lib/project-storage)"
```

---

## Task 4: DB upload session functions

**Files:**
- Modify: `supabase/functions/basecamp-mcp/db.ts`

- [ ] **Step 1: Append upload session functions to db.ts**

Add after the last function in `supabase/functions/basecamp-mcp/db.ts`:

```typescript
// ─── Upload Sessions ──────────────────────────────────────────────────────────

export async function getProjectForUpload(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, slug, project_code, storage_project_dir, archived, clients(code, archived_at)")
    .eq("id", projectId)
    .single();
  if (error || !data) return null;
  const clients = data.clients as
    | { code: string; archived_at: string | null }
    | { code: string; archived_at: string | null }[]
    | null;
  return {
    id: data.id as string,
    name: data.name as string,
    slug: data.slug as string,
    project_code: data.project_code as string | null,
    storage_project_dir: data.storage_project_dir as string | null,
    archived: data.archived as boolean,
    clients: Array.isArray(clients) ? (clients[0] ?? null) : clients,
  };
}

export async function createUploadSession(
  supabase: SupabaseClient,
  params: {
    client_id: string;
    project_id: string;
    dropbox_session_id: string;
    target_path: string;
    filename: string;
    mime_type: string;
    total_bytes: number;
  }
) {
  const expires_at = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("upload_sessions")
    .insert({
      client_id: params.client_id,
      project_id: params.project_id,
      dropbox_session_id: params.dropbox_session_id,
      target_path: params.target_path,
      filename: params.filename,
      mime_type: params.mime_type,
      total_bytes: params.total_bytes,
      expires_at,
    })
    .select()
    .single();
  if (error) throw error;
  return data as { id: string; [key: string]: unknown };
}

export async function getUploadSession(
  supabase: SupabaseClient,
  sessionId: string,
  clientId: string
) {
  const { data, error } = await supabase
    .from("upload_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("client_id", clientId)
    .single();
  if (error || !data) return null;
  return data as {
    id: string;
    client_id: string;
    project_id: string;
    dropbox_session_id: string;
    target_path: string;
    filename: string;
    mime_type: string;
    total_bytes: number;
    offset: number;
    created_at: string;
    expires_at: string;
  };
}

export async function updateUploadSessionOffset(
  supabase: SupabaseClient,
  sessionId: string,
  newOffset: number
) {
  const { error } = await supabase
    .from("upload_sessions")
    .update({ offset: newOffset })
    .eq("id", sessionId);
  if (error) throw error;
}

export async function deleteUploadSession(supabase: SupabaseClient, sessionId: string) {
  const { error } = await supabase
    .from("upload_sessions")
    .delete()
    .eq("id", sessionId);
  if (error) throw error;
}

export async function cleanExpiredUploadSessions(supabase: SupabaseClient) {
  await supabase
    .from("upload_sessions")
    .delete()
    .lt("expires_at", new Date().toISOString());
}
```

- [ ] **Step 2: Run existing tests to verify no regressions**

```bash
TMPDIR=/tmp/codex-vitest npm test
```

Expected: All existing tests pass (new functions have no tests yet — covered in Tasks 5–7).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/basecamp-mcp/db.ts
git commit -m "feat(mcp): add upload session DB functions and getProjectForUpload"
```

---

## Task 5: upload_start tool + test infrastructure

**Files:**
- Modify: `supabase/functions/basecamp-mcp/tools.ts`
- Create: `tests/unit/mcp-upload-tools.test.ts`

- [ ] **Step 1: Create mcp-upload-tools.test.ts with infrastructure + upload_start tests**

```typescript
// tests/unit/mcp-upload-tools.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub Deno global (dropbox.ts and tools.ts transitively reference Deno.env)
vi.stubGlobal("Deno", { env: { get: () => undefined } });

// ─── Module mocks (declared before vi.mock calls) ──────────────────────────────

// db mocks
const mockGetProjectForUpload = vi.fn();
const mockCleanExpiredUploadSessions = vi.fn();
const mockCreateUploadSession = vi.fn();
const mockGetUploadSession = vi.fn();
const mockUpdateUploadSessionOffset = vi.fn();
const mockDeleteUploadSession = vi.fn();
const mockCreateFile = vi.fn();

vi.mock("../../supabase/functions/basecamp-mcp/db.ts", () => ({
  listProjects: vi.fn(),
  listArchivedProjects: vi.fn(),
  getProject: vi.fn(),
  getThread: vi.fn(),
  listFiles: vi.fn(),
  getFile: vi.fn(),
  searchContent: vi.fn(),
  listClients: vi.fn(),
  getClient: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  createThread: vi.fn(),
  createComment: vi.fn(),
  createFile: mockCreateFile,
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  getProjectForNotification: vi.fn(),
  listNotificationRecipients: vi.fn(),
  getProjectForUpload: mockGetProjectForUpload,
  cleanExpiredUploadSessions: mockCleanExpiredUploadSessions,
  createUploadSession: mockCreateUploadSession,
  getUploadSession: mockGetUploadSession,
  updateUploadSessionOffset: mockUpdateUploadSessionOffset,
  deleteUploadSession: mockDeleteUploadSession,
}));

// dropbox mocks
const mockStartUploadSession = vi.fn();
const mockAppendUploadChunk = vi.fn();
const mockFinishUploadSession = vi.fn();

class FakeDropboxConfigError extends Error {}
class FakeDropboxStorageError extends Error {
  constructor(msg: string) { super(msg); }
}
class FakeDropboxAuthError extends Error {}

vi.mock("../../supabase/functions/basecamp-mcp/dropbox.ts", () => ({
  startUploadSession: mockStartUploadSession,
  appendUploadChunk: mockAppendUploadChunk,
  finishUploadSession: mockFinishUploadSession,
  downloadFile: vi.fn(),
  getTemporaryLink: vi.fn(),
  DropboxConfigError: FakeDropboxConfigError,
  DropboxStorageError: FakeDropboxStorageError,
  DropboxAuthError: FakeDropboxAuthError,
  _resetTokenCache: vi.fn(),
}));

// Other deps tools.ts imports
vi.mock("marked", () => ({ marked: vi.fn((s: string) => s) }));
vi.mock("../../../lib/project-status.ts", () => ({
  PROJECT_STATUSES_ZOD: ["active", "paused", "complete", "billing"] as const,
}));
vi.mock("../../supabase/functions/basecamp-mcp/notify.ts", () => ({
  notifyBestEffort: vi.fn(),
}));

// ─── Load tools.ts after mocks ────────────────────────────────────────────────

const { registerTools } = await import("../../supabase/functions/basecamp-mcp/tools.ts");

// ─── Test helpers ─────────────────────────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function makeCapturingServer() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    tool(_name: string, _desc: string, _shape: unknown, handler: ToolHandler) {
      tools.set(_name, handler);
    },
  };
  return { server, tools };
}

const mockSupabase = {} as any;
const mockAgent = { client_id: "agent-123", name: "Test Agent" };

function getTools() {
  const { server, tools } = makeCapturingServer();
  registerTools(server as any, mockSupabase, mockAgent as any);
  return tools;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── upload_start tests ───────────────────────────────────────────────────────

describe("upload_start", () => {
  const project = {
    id: "proj-uuid",
    name: "ACME Website",
    slug: "acme-website",
    project_code: "ACME-0001",
    storage_project_dir: "/projects/acme/ACME-0001-ACME-Website",
    archived: false,
    clients: { code: "ACME", archived_at: null },
  };

  it("returns session_id, target_path, and chunk_size_bytes on success", async () => {
    mockGetProjectForUpload.mockResolvedValue(project);
    mockCleanExpiredUploadSessions.mockResolvedValue(undefined);
    mockStartUploadSession.mockResolvedValue("dbx-sess-abc");
    mockCreateUploadSession.mockResolvedValue({ id: "sess-uuid" });

    const tools = getTools();
    const result = await tools.get("upload_start")!({
      project_id: "proj-uuid",
      filename: "report.csv",
      mime_type: "text/csv",
      total_bytes: 1024,
    }) as any;

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.session_id).toBe("sess-uuid");
    expect(body.chunk_size_bytes).toBe(2097152);
    expect(body.target_path).toContain("report.csv");
    expect(body.target_path).toContain("/projects/acme/ACME-0001-ACME-Website/uploads/");
    expect(mockCreateUploadSession).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({
        client_id: "agent-123",
        project_id: "proj-uuid",
        dropbox_session_id: "dbx-sess-abc",
        filename: "report.csv",
        mime_type: "text/csv",
        total_bytes: 1024,
      })
    );
  });

  it("returns notFound when project does not exist", async () => {
    mockGetProjectForUpload.mockResolvedValue(null);

    const tools = getTools();
    const result = await tools.get("upload_start")!({
      project_id: "missing-uuid",
      filename: "report.csv",
      mime_type: "text/csv",
      total_bytes: 1024,
    }) as any;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("missing-uuid");
  });

  it("returns error when client is archived", async () => {
    mockGetProjectForUpload.mockResolvedValue({
      ...project,
      clients: { code: "ACME", archived_at: "2024-01-01T00:00:00Z" },
    });
    mockCleanExpiredUploadSessions.mockResolvedValue(undefined);

    const tools = getTools();
    const result = await tools.get("upload_start")!({
      project_id: "proj-uuid",
      filename: "file.txt",
      mime_type: "text/plain",
      total_bytes: 100,
    }) as any;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Client is archived");
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-upload-tools.test.ts
```

Expected: FAIL — tool `upload_start` not found (returns undefined from `tools.get`)

- [ ] **Step 3: Add import to tools.ts**

At the top of `supabase/functions/basecamp-mcp/tools.ts`, add after the existing imports:

```typescript
import { resolveProjectStorageDir, generateUploadTargetPath } from "./upload-helpers.ts";
```

- [ ] **Step 4: Add upload_start tool to tools.ts**

Append inside the `registerTools` function (after the `update_my_profile` tool, before the closing `}`):

```typescript
  // ─── Upload ────────────────────────────────────────────────────────────────

  server.tool(
    "upload_start",
    "Start a chunked file upload to a project. Returns a session_id to use with upload_chunk and upload_finish. Send file bytes as base64 in ~2MB chunks.",
    {
      project_id: z.string().uuid(),
      filename: z.string().min(1).max(255),
      mime_type: z.string().min(1).max(100),
      total_bytes: z.number().int().positive(),
    },
    async ({ project_id, filename, mime_type, total_bytes }) => {
      try {
        const project = await db.getProjectForUpload(supabase, project_id);
        if (!project) return notFound(project_id);

        if (project.clients?.archived_at) {
          return { isError: true as const, content: [{ type: "text" as const, text: "Client is archived" }] };
        }

        await db.cleanExpiredUploadSessions(supabase);

        const storageDir = resolveProjectStorageDir(project);
        const targetPath = generateUploadTargetPath(storageDir, filename);
        const dropboxSessionId = await dropbox.startUploadSession();

        const session = await db.createUploadSession(supabase, {
          client_id: agent.client_id,
          project_id,
          dropbox_session_id: dropboxSessionId,
          target_path: targetPath,
          filename,
          mime_type,
          total_bytes,
        });

        return ok({ session_id: session.id, target_path: targetPath, chunk_size_bytes: 2097152 });
      } catch (e) {
        if (
          e instanceof dropbox.DropboxConfigError ||
          e instanceof dropbox.DropboxStorageError ||
          e instanceof dropbox.DropboxAuthError
        ) {
          return dropboxError(e);
        }
        return dbError(e);
      }
    }
  );
```

- [ ] **Step 5: Run to verify tests pass**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-upload-tools.test.ts
```

Expected: 3 upload_start tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/basecamp-mcp/tools.ts tests/unit/mcp-upload-tools.test.ts
git commit -m "feat(mcp): add upload_start tool"
```

---

## Task 6: upload_chunk tool

**Files:**
- Modify: `supabase/functions/basecamp-mcp/tools.ts`
- Modify: `tests/unit/mcp-upload-tools.test.ts`

- [ ] **Step 1: Write failing tests — append to mcp-upload-tools.test.ts**

```typescript
// ─── upload_chunk tests ───────────────────────────────────────────────────────

describe("upload_chunk", () => {
  const activeSession = {
    id: "sess-uuid",
    client_id: "agent-123",
    project_id: "proj-uuid",
    dropbox_session_id: "dbx-sess-abc",
    target_path: "/projects/acme/ACME-0001-Website/uploads/123-report.csv",
    filename: "report.csv",
    mime_type: "text/csv",
    total_bytes: 10,
    offset: 0,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  };

  it("forwards bytes to Dropbox and returns new offset", async () => {
    mockGetUploadSession.mockResolvedValue(activeSession);
    mockAppendUploadChunk.mockResolvedValue(undefined);
    mockUpdateUploadSessionOffset.mockResolvedValue(undefined);

    // base64("hello") = "aGVsbG8=" → 5 bytes
    const tools = getTools();
    const result = await tools.get("upload_chunk")!({
      session_id: "sess-uuid",
      data: "aGVsbG8=",
      offset: 0,
    }) as any;

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.offset).toBe(5);
    expect(body.bytes_remaining).toBe(5); // 10 total - 5 uploaded
    expect(mockAppendUploadChunk).toHaveBeenCalledWith(
      "dbx-sess-abc",
      0,
      expect.any(Uint8Array)
    );
    expect(mockUpdateUploadSessionOffset).toHaveBeenCalledWith(mockSupabase, "sess-uuid", 5);
  });

  it("returns notFound when session does not exist", async () => {
    mockGetUploadSession.mockResolvedValue(null);

    const tools = getTools();
    const result = await tools.get("upload_chunk")!({
      session_id: "missing-sess",
      data: "aGVsbG8=",
      offset: 0,
    }) as any;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("missing-sess");
  });

  it("returns error when session is expired", async () => {
    mockGetUploadSession.mockResolvedValue({
      ...activeSession,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    const tools = getTools();
    const result = await tools.get("upload_chunk")!({
      session_id: "sess-uuid",
      data: "aGVsbG8=",
      offset: 0,
    }) as any;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Upload session expired");
  });

  it("returns error when offset does not match session", async () => {
    mockGetUploadSession.mockResolvedValue({ ...activeSession, offset: 5 });

    const tools = getTools();
    const result = await tools.get("upload_chunk")!({
      session_id: "sess-uuid",
      data: "aGVsbG8=",
      offset: 0,
    }) as any;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Offset mismatch");
    expect(result.content[0].text).toContain("expected 5");
    expect(result.content[0].text).toContain("got 0");
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-upload-tools.test.ts
```

Expected: 4 new tests FAIL — tool `upload_chunk` not found

- [ ] **Step 3: Add upload_chunk tool to tools.ts**

Append after `upload_start` inside `registerTools`:

```typescript
  server.tool(
    "upload_chunk",
    "Send a chunk of bytes for an active upload session. data must be base64-encoded. offset must equal the byte count already received (0 for first chunk, or the offset returned by the previous upload_chunk call).",
    {
      session_id: z.string().uuid(),
      data: z.string().min(1),
      offset: z.number().int().min(0),
    },
    async ({ session_id, data, offset }) => {
      try {
        const session = await db.getUploadSession(supabase, session_id, agent.client_id);
        if (!session) return notFound(session_id);

        if (new Date(session.expires_at) < new Date()) {
          return { isError: true as const, content: [{ type: "text" as const, text: "Upload session expired" }] };
        }

        if (offset !== Number(session.offset)) {
          return {
            isError: true as const,
            content: [{ type: "text" as const, text: `Offset mismatch: expected ${session.offset}, got ${offset}` }],
          };
        }

        const binaryStr = atob(data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        await dropbox.appendUploadChunk(session.dropbox_session_id, offset, bytes);

        const newOffset = offset + bytes.length;
        await db.updateUploadSessionOffset(supabase, session_id, newOffset);

        return ok({ offset: newOffset, bytes_remaining: Number(session.total_bytes) - newOffset });
      } catch (e) {
        if (
          e instanceof dropbox.DropboxConfigError ||
          e instanceof dropbox.DropboxStorageError ||
          e instanceof dropbox.DropboxAuthError
        ) {
          return dropboxError(e);
        }
        return dbError(e);
      }
    }
  );
```

- [ ] **Step 4: Run to verify tests pass**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-upload-tools.test.ts
```

Expected: All 7 tests (3 upload_start + 4 upload_chunk) PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/basecamp-mcp/tools.ts tests/unit/mcp-upload-tools.test.ts
git commit -m "feat(mcp): add upload_chunk tool"
```

---

## Task 7: upload_finish tool

**Files:**
- Modify: `supabase/functions/basecamp-mcp/tools.ts`
- Modify: `tests/unit/mcp-upload-tools.test.ts`

- [ ] **Step 1: Write failing tests — append to mcp-upload-tools.test.ts**

```typescript
// ─── upload_finish tests ──────────────────────────────────────────────────────

describe("upload_finish", () => {
  const completeSession = {
    id: "sess-uuid",
    client_id: "agent-123",
    project_id: "proj-uuid",
    dropbox_session_id: "dbx-sess-abc",
    target_path: "/projects/acme/ACME-0001-Website/uploads/123-report.csv",
    filename: "report.csv",
    mime_type: "text/csv",
    total_bytes: 5,
    offset: 5,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  };

  const dropboxMeta = {
    id: "id:XJWabcABCABC123",
    path_display: "/projects/acme/ACME-0001-Website/uploads/123-report.csv",
    size: 5,
  };

  const createdFile = {
    id: "file-uuid",
    project_id: "proj-uuid",
    filename: "report.csv",
    mime_type: "text/csv",
    size_bytes: 5,
    dropbox_file_id: "id:XJWabcABCABC123",
    dropbox_path: "/projects/acme/ACME-0001-Website/uploads/123-report.csv",
    checksum: "abc123",
    thread_id: null,
    comment_id: null,
    created_at: new Date().toISOString(),
  };

  it("commits upload, creates project_files record, and deletes session", async () => {
    mockGetUploadSession.mockResolvedValue(completeSession);
    mockFinishUploadSession.mockResolvedValue(dropboxMeta);
    mockCreateFile.mockResolvedValue(createdFile);
    mockDeleteUploadSession.mockResolvedValue(undefined);

    const tools = getTools();
    const result = await tools.get("upload_finish")!({
      session_id: "sess-uuid",
      checksum: "abc123",
    }) as any;

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0].text);
    expect(body.id).toBe("file-uuid");
    expect(body.filename).toBe("report.csv");

    expect(mockFinishUploadSession).toHaveBeenCalledWith(
      "dbx-sess-abc",
      5,
      "/projects/acme/ACME-0001-Website/uploads/123-report.csv"
    );
    expect(mockCreateFile).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({
        project_id: "proj-uuid",
        filename: "report.csv",
        mime_type: "text/csv",
        size_bytes: 5,
        dropbox_file_id: "id:XJWabcABCABC123",
        checksum: "abc123",
        thread_id: undefined,
        comment_id: undefined,
      }),
      "agent-123"
    );
    expect(mockDeleteUploadSession).toHaveBeenCalledWith(mockSupabase, "sess-uuid");
  });

  it("returns notFound when session does not exist", async () => {
    mockGetUploadSession.mockResolvedValue(null);

    const tools = getTools();
    const result = await tools.get("upload_finish")!({ session_id: "missing" }) as any;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("missing");
  });

  it("returns error when upload is incomplete", async () => {
    mockGetUploadSession.mockResolvedValue({ ...completeSession, offset: 3 });

    const tools = getTools();
    const result = await tools.get("upload_finish")!({ session_id: "sess-uuid" }) as any;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Upload incomplete");
    expect(result.content[0].text).toContain("3 of 5");
  });

  it("passes thread_id and comment_id to createFile when provided", async () => {
    mockGetUploadSession.mockResolvedValue(completeSession);
    mockFinishUploadSession.mockResolvedValue(dropboxMeta);
    mockCreateFile.mockResolvedValue({ ...createdFile, thread_id: "thread-uuid", comment_id: "comment-uuid" });
    mockDeleteUploadSession.mockResolvedValue(undefined);

    const tools = getTools();
    await tools.get("upload_finish")!({
      session_id: "sess-uuid",
      thread_id: "thread-uuid",
      comment_id: "comment-uuid",
    });

    expect(mockCreateFile).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({ thread_id: "thread-uuid", comment_id: "comment-uuid" }),
      "agent-123"
    );
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-upload-tools.test.ts
```

Expected: 4 new tests FAIL — tool `upload_finish` not found

- [ ] **Step 3: Add upload_finish tool to tools.ts**

Append after `upload_chunk` inside `registerTools`:

```typescript
  server.tool(
    "upload_finish",
    "Finalize a file upload after all chunks have been sent with upload_chunk. Commits the Dropbox upload session and registers the file in project_files. Optionally attach the file to a thread or comment.",
    {
      session_id: z.string().uuid(),
      checksum: z.string().optional(),
      thread_id: z.string().uuid().optional(),
      comment_id: z.string().uuid().optional(),
    },
    async ({ session_id, checksum, thread_id, comment_id }) => {
      try {
        const session = await db.getUploadSession(supabase, session_id, agent.client_id);
        if (!session) return notFound(session_id);

        if (Number(session.offset) !== Number(session.total_bytes)) {
          return {
            isError: true as const,
            content: [{
              type: "text" as const,
              text: `Upload incomplete: ${session.offset} of ${session.total_bytes} bytes received`,
            }],
          };
        }

        const metadata = await dropbox.finishUploadSession(
          session.dropbox_session_id,
          Number(session.offset),
          session.target_path
        );

        const file = await db.createFile(
          supabase,
          {
            project_id: session.project_id,
            filename: session.filename,
            mime_type: session.mime_type,
            size_bytes: metadata.size,
            dropbox_file_id: metadata.id,
            dropbox_path: metadata.path_display,
            checksum: checksum ?? "",
            thread_id,
            comment_id,
          },
          agent.client_id
        );

        await db.deleteUploadSession(supabase, session_id);

        return ok(file);
      } catch (e) {
        if (
          e instanceof dropbox.DropboxConfigError ||
          e instanceof dropbox.DropboxStorageError ||
          e instanceof dropbox.DropboxAuthError
        ) {
          return dropboxError(e);
        }
        return dbError(e);
      }
    }
  );
```

- [ ] **Step 4: Run the full test suite**

```bash
TMPDIR=/tmp/codex-vitest npm test
```

Expected: All tests pass including 11 tests in mcp-upload-tools.test.ts.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/basecamp-mcp/tools.ts tests/unit/mcp-upload-tools.test.ts
git commit -m "feat(mcp): add upload_finish tool"
```

---

## Task 8: Smoke test update

**Files:**
- Modify: `tests/integration/mcp-smoke.test.ts`

- [ ] **Step 1: Update tool count from 18 to 21**

In `tests/integration/mcp-smoke.test.ts`, find:

```typescript
expect(response.result?.tools).toHaveLength(18);
```

Replace with:

```typescript
expect(response.result?.tools).toHaveLength(21);
```

- [ ] **Step 2: Add upload tool name assertions**

After the line `expect(names).toContain("get_my_profile");`, add:

```typescript
    expect(names).toContain("upload_start");
    expect(names).toContain("upload_chunk");
    expect(names).toContain("upload_finish");
```

- [ ] **Step 3: Run the smoke test**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/integration/mcp-smoke.test.ts
```

Expected: Configuration tests PASS. Live tests skip gracefully if `MCP_SMOKE_URL`/`MCP_SMOKE_JWT` are not set.

- [ ] **Step 4: Run full test suite**

```bash
TMPDIR=/tmp/codex-vitest npm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/mcp-smoke.test.ts
git commit -m "test(mcp): update smoke test for 21 tools (upload_start, upload_chunk, upload_finish)"
```

---

## Handoff Notes

**Schema changes:** `upload_sessions` table (migration 0025) must be applied to Supabase before deploying the edge function. Run migrations via the Supabase dashboard or CLI.

**Env vars:** No new env vars required. The Dropbox SDK credentials already in use (`DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`) cover upload sessions.

**Deploy:** After all tasks pass locally, deploy the edge function:
```bash
supabase functions deploy basecamp-mcp
```
