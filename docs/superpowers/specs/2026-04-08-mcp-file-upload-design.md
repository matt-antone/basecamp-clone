# MCP File Upload — Design Spec

**Date:** 2026-04-08
**Branch:** `worktree-mcp-file-download-clients`
**Status:** Approved

## Problem

Agents posting via the Basecamp MCP server cannot upload files. The existing `create_file` tool only registers metadata for files already uploaded to Dropbox — there is no way for an agent to push file bytes through MCP.

## Use Case

Agents generate files themselves (reports, CSVs, summary documents) and need to upload them to Dropbox and register them in `project_files`, using the same conventions as the Next.js app.

## Approach

Three new MCP tools implementing a chunked upload flow. The agent sends file bytes in ~2MB base64-encoded chunks. The MCP server manages the Dropbox upload session transparently — the agent never interacts with Dropbox directly.

Session state is persisted in a new `upload_sessions` Supabase table so uploads survive edge function instance recycling.

## Tool Definitions

### `upload_start`

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project_id` | uuid | yes | Target project |
| `filename` | string | yes | e.g. `"monthly-report.csv"` |
| `mime_type` | string | yes | e.g. `"text/csv"` |
| `total_bytes` | integer | yes | Total file size in bytes |

**Behavior:**
1. Validate project exists in DB (must include `storage_project_dir`, `project_code`, `name`/`slug` fields).
2. Derive the project's Dropbox storage directory using the same logic as `lib/project-storage.ts#getProjectStorageDir` — prefer `storage_project_dir` if set, otherwise compute from client code + project folder base name.
3. Validate client is not archived.
4. Generate target path: `{storageDir}/uploads/{timestamp}-{sanitized_filename}`.
5. Call Dropbox SDK `filesUploadSessionStart({ close: false })`.
6. Insert row into `upload_sessions` table.
7. Clean up expired sessions lazily.

**Output:**
| Field | Type | Description |
|-------|------|-------------|
| `session_id` | uuid | Our internal session ID |
| `target_path` | string | Resolved Dropbox path (informational) |
| `chunk_size_bytes` | integer | Recommended chunk size (2097152 = 2MB) |

### `upload_chunk`

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `session_id` | uuid | yes | From `upload_start` |
| `data` | string | yes | Base64-encoded chunk |
| `offset` | integer | yes | Byte offset for this chunk |

**Behavior:**
1. Read session from `upload_sessions` — error if not found or expired.
2. Validate `client_id` from JWT matches session's `client_id`.
3. Validate offset matches session's tracked offset.
4. Decode base64 → bytes.
5. Call Dropbox SDK `filesUploadSessionAppendV2({ cursor: { session_id, offset }, close: false, contents: bytes })`.
6. Update session's `offset` in DB.

**Output:**
| Field | Type | Description |
|-------|------|-------------|
| `offset` | integer | New offset after this chunk |
| `bytes_remaining` | integer | `total_bytes - new_offset` |

### `upload_finish`

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `session_id` | uuid | yes | From `upload_start` |
| `checksum` | string | no | SHA-256 hex digest of full file |
| `thread_id` | uuid | no | Attach file to a thread |
| `comment_id` | uuid | no | Attach file to a comment (requires `thread_id`) |

**Behavior:**
1. Read session from `upload_sessions` — error if not found.
2. Validate `client_id` from JWT matches session's `client_id`.
3. Validate offset equals `total_bytes` (all chunks received).
4. Validate `thread_id`/`comment_id` exist if provided.
5. Call Dropbox SDK `filesUploadSessionFinish({ cursor: { session_id, offset }, commit: { path: targetPath, autorename: true, mode: "add", mute: false } })`.
6. Insert row into `project_files` using existing `db.createFile()` with Dropbox response's `id` and `path_display`.
7. Delete session row from `upload_sessions`.
8. Trigger thumbnail job best-effort (if applicable).

**Output:**
- The created `project_files` record (same shape as `create_file` returns today).

## Database Schema

New table:

```sql
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
```

- TTL: 6 hours (set `expires_at = now() + interval '6 hours'` on insert).
- Expired rows cleaned lazily on each `upload_start` call.
- No cron needed.

## Session Lifecycle

### Resume after failure
- Agent retries `upload_chunk` with the same offset — safe because we validate offset matches DB.
- If edge function recycled mid-chunk, Dropbox didn't get the bytes, our offset didn't update, agent resends same chunk.
- Agent can query current state by calling `upload_chunk` with its last known offset — error message includes expected offset.

### Expiry
- 6-hour TTL, well within Dropbox's 7-day session window.
- Expired rows deleted lazily during `upload_start`.

### Security
- Every call validates `client_id` from JWT matches session's `client_id`.
- No cross-agent session access.
- Same JWT auth as all other MCP tools.

## Error Handling

| Scenario | Error message |
|----------|---------------|
| Invalid `project_id` | "Project not found" |
| Client archived | "Client is archived" |
| Session not found | "Upload session not found" |
| Session expired | "Upload session expired" |
| Wrong agent | "Upload session not found" (no info leak) |
| Offset mismatch | "Offset mismatch: expected X, got Y" |
| Incomplete upload on finish | "Upload incomplete: X of Y bytes received" |
| `comment_id` without `thread_id` | Validation error |
| Dropbox errors | Classified through existing `classifyError` |

## File Changes

### New functions in `dropbox.ts`
- `startUploadSession()` → `filesUploadSessionStart`
- `appendUploadChunk(sessionId, offset, bytes)` → `filesUploadSessionAppendV2`
- `finishUploadSession(sessionId, offset, targetPath)` → `filesUploadSessionFinish`

### New helper in MCP: path resolution
- `resolveProjectStorageDir(project)` — port of `lib/project-storage.ts#getProjectStorageDir` logic for the Deno edge function. Uses `storage_project_dir` from the project record if set; otherwise computes from `project_code`, `name`, and Dropbox root config. This is a small pure function (~20 lines).
- The existing `db.ts#getProject` query must be extended to include `storage_project_dir`, `project_code`, `name`, and `client_code` fields in the select.

### New functions in `db.ts`
- `createUploadSession(supabase, params)`
- `getUploadSession(supabase, sessionId, clientId)`
- `updateUploadSessionOffset(supabase, sessionId, newOffset)`
- `deleteUploadSession(supabase, sessionId)`
- `cleanExpiredUploadSessions(supabase)`

### New tools in `tools.ts`
- `upload_start`, `upload_chunk`, `upload_finish`

### Existing code — no changes
- `create_file` tool remains as-is (different purpose: registering metadata for externally-uploaded files).

### Migration
- One new migration for `upload_sessions` table.

### Tests
- `tests/unit/mcp-dropbox.test.ts` — new tests for upload session functions.
- `tests/unit/mcp-upload-tools.test.ts` (new) — tests for the three upload tools.
- `tests/integration/mcp-smoke.test.ts` — update tool count from 18 to 21.

## Agent UX Example

```
1. upload_start({ project_id, filename: "report.csv", mime_type: "text/csv", total_bytes: 5242880 })
   → { session_id: "sess-xyz", target_path: "/projects/ACME/...", chunk_size_bytes: 2097152 }

2. upload_chunk({ session_id: "sess-xyz", data: "<base64 chunk 1>", offset: 0 })
   → { offset: 2097152, bytes_remaining: 3145728 }

3. upload_chunk({ session_id: "sess-xyz", data: "<base64 chunk 2>", offset: 2097152 })
   → { offset: 4194304, bytes_remaining: 1048576 }

4. upload_chunk({ session_id: "sess-xyz", data: "<base64 chunk 3>", offset: 4194304 })
   → { offset: 5242880, bytes_remaining: 0 }

5. upload_finish({ session_id: "sess-xyz", checksum: "a1b2c3...", thread_id: "thread-456" })
   → { id: "file-789", filename: "report.csv", ... }
```
