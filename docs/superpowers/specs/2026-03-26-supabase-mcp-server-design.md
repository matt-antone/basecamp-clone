# Supabase Edge MCP Server — Design Spec

**Date:** 2026-03-26
**Status:** Approved
**Scope:** Add a Model Context Protocol server for basecamp-clone, hosted as a Supabase Edge Function, exposing core content (projects, threads, comments, files) and agent profiles to AI coding agents.

---

## 1. Purpose & Consumers

This MCP server gives AI coding agents (Claude, Codex, Cursor, OpenClaw) direct, authenticated access to basecamp-clone data. Agents can read and write core content and manage their own identity/profile. No UI or human-facing surface — this is an agent-only interface.

---

## 2. Architecture

**Runtime:** Deno edge function deployed to Supabase
**Entry point:** `supabase/functions/basecamp-mcp/index.ts`
**Transport:** Streamable HTTP — MCP JSON-RPC over `POST /`
**McpServer lifecycle:** Fresh instance per request (stateless, same pattern as `ai-memory`)

**File layout:**
```
supabase/
  functions/
    basecamp-mcp/
      index.ts      — entry point, request routing, McpServer setup
      tools.ts      — all tool definitions + handlers
      auth.ts       — agent auth + identity resolution
      db.ts         — Supabase query helpers (typed wrappers)
  migrations/
    0011_agent_profiles.sql
```

**Endpoints:**
- `GET /healthz` — liveness (always 200)
- `GET /readyz` — readiness (pings Supabase)
- `POST /` — MCP JSON-RPC

**DB access:** Uses `SUPABASE_SERVICE_ROLE_KEY` (available in edge function env by default) to bypass RLS. Agent-level permissions are enforced in tool handlers.

---

## 3. Auth & Agent Identity

### Env vars

```
MCP_ACCESS_KEY        # admin key (legacy single)
MCP_ACCESS_KEYS       # comma-separated admin keys
MCP_CLIENTS_JSON      # JSON array of per-agent client credentials
MCP_RATE_LIMIT_RPM    # requests per minute per agent (default: 120)
```

### `MCP_CLIENTS_JSON` shape

```json
[
  { "client_id": "claude",   "secret": "...", "role": "agent", "disabled": false },
  { "client_id": "codex",    "secret": "...", "role": "agent", "disabled": false },
  { "client_id": "cursor",   "secret": "...", "role": "agent", "disabled": false },
  { "client_id": "openclaw", "secret": "...", "role": "agent", "disabled": false }
]
```

### Request headers

```
Authorization: Bearer <secret>
x-mcp-client-id: claude
```

The edge function resolves headers → `{ client_id, role }`. This identity is used for:
- Rate limiting (per `client_id`)
- Stamping `author_user_id = client_id` on all writes
- Profile lookup / auto-creation

### Roles

- `agent` — full access to all 15 tools
- `admin` — same as agent in v1; reserved for future elevated operations

### Agent profile auto-creation

On first successful auth, if no profile row exists for the `client_id`, one is created automatically with defaults. The agent can then update it.

---

## 4. Database Changes

### New table: `agent_profiles`

```sql
-- migration: 0011_agent_profiles.sql
create table if not exists agent_profiles (
  client_id   text primary key,
  name        text,
  avatar_url  text,
  bio         text,
  preferences jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

No changes to existing tables. Agent writes stamp `author_user_id` with the agent's `client_id` — this reuses the existing text column already present on `discussion_threads` and `discussion_comments`.

---

## 5. Tool Set (15 tools)

### 5.1 Read tools

#### `list_projects`
Returns all non-archived projects.
**Returns:** `[{ id, name, slug, description, deadline, status, client_name, created_at }]`

#### `get_project`
Returns full project detail: metadata + last 10 threads (with comment counts) + total file count (project-level and thread-attached) + client info.
**Params:** `{ project_id: string }`
**Returns:** `{ project, threads: [{ id, title, comment_count, created_at }], file_count, client }`

#### `get_thread`
Returns a full thread with all comments in chronological order, plus files attached to the thread and files attached to each comment.
**Params:** `{ thread_id: string }`
**Returns:** `{ thread: { id, title, body_markdown, author_user_id, created_at }, comments: [{ id, body_markdown, author_user_id, edited_at, created_at, files: [...] }], files: [...] }`

#### `list_files`
Lists files for a project. Optionally filter to files attached to a specific thread.
**Params:** `{ project_id: string, thread_id?: string }`
**Returns:** `[{ id, filename, mime_type, size_bytes, dropbox_file_id, thread_id, comment_id, created_at }]`

#### `get_file`
Returns full metadata for a single file.
**Params:** `{ file_id: string }`
**Returns:** `{ id, project_id, filename, mime_type, size_bytes, dropbox_file_id, dropbox_path, checksum, thread_id, comment_id, uploader_user_id, created_at }`

#### `search_content`
Full-text search across discussion threads and comments using Postgres `to_tsvector`. Optionally scoped to a project.
**Params:** `{ query: string, project_id?: string, limit?: number }` — `limit` defaults to 20, max 100
**Returns:** `[{ type: 'thread'|'comment', id, project_id, title?, excerpt, created_at }]`

---

### 5.2 Write tools

#### `create_project`
Creates a new project. `author_user_id` is stamped from the calling agent's `client_id`.
**Params:** `{ name: string, description?: string, deadline?: string, business_client_id?: string }` — `business_client_id` is the UUID of a row in the `clients` table (not the MCP agent's client_id)
**Returns:** Created project object.

#### `update_project`
Updates mutable project fields. Partial update — only provided fields are changed.
**Params:** `{ project_id: string, name?: string, description?: string, deadline?: string, status?: string, archived?: boolean }`
**Returns:** Updated project object.

#### `create_thread`
Creates a discussion thread. Body is accepted as Markdown; HTML is generated via the existing `lib/markdown.ts` converter (imported via `npm:` specifier).
**Params:** `{ project_id: string, title: string, body_markdown: string }`
**Returns:** Created thread object.

#### `update_thread`
Updates a thread's title and/or body.
**Params:** `{ thread_id: string, title?: string, body_markdown?: string }`
**Returns:** Updated thread object.

#### `create_comment`
Adds a comment to a thread. Markdown → HTML conversion applied.
**Params:** `{ thread_id: string, body_markdown: string }`
**Returns:** Created comment object.

#### `update_comment`
Updates a comment's body. Sets `edited_at` to current timestamp.
**Params:** `{ comment_id: string, body_markdown: string }`
**Returns:** Updated comment object.

---

### 5.3 File tools

#### `create_file`
Registers file metadata after the agent has uploaded the file bytes to Dropbox. Optionally attach to a thread or comment.
**Params:** `{ project_id: string, filename: string, mime_type: string, size_bytes: number, dropbox_file_id: string, dropbox_path: string, checksum: string, thread_id?: string, comment_id?: string }`
**Returns:** Created file metadata object.

---

### 5.4 Agent profile tools

#### `get_my_profile`
Returns the calling agent's profile.
**Params:** none
**Returns:** `{ client_id, name, avatar_url, bio, preferences, created_at, updated_at }`

#### `update_my_profile`
Updates the agent's profile. Partial update — provided top-level fields overwrite existing values; `preferences` is key-merged (new keys added, existing keys updated, unmentioned keys left unchanged) rather than fully replaced.
**Params:** `{ name?: string, avatar_url?: string, bio?: string, preferences?: object }`
**Returns:** Updated profile object.

---

## 6. Error Handling

All tool handlers return structured MCP error responses — no raw exceptions reach agents.

| Category | Condition | Code |
|----------|-----------|------|
| Auth failure | bad key, unknown client_id, disabled agent | 401 |
| Not found | unknown id passed to any get/update tool | 404 |
| Validation | missing required param, invalid UUID format | 400 |
| DB error | Supabase unreachable, constraint violation | 500 (sanitized) |

Raw Postgres error messages are never returned. DB errors are caught, logged server-side, and returned as a generic message to the agent.

**Rate limiting:** In-memory sliding window per `client_id`. Default: 120 req/60s. Configurable via `MCP_RATE_LIMIT_RPM`. Resets on cold start (Deno isolate). Returns HTTP 429 with `Retry-After` header when exceeded.

---

## 7. Testing Strategy

### Unit tests (`tests/unit/mcp-*.test.ts`)
- Vitest + Supabase stub (no live DB required)
- One test file per tool group: `mcp-read-tools`, `mcp-write-tools`, `mcp-file-tools`, `mcp-profile-tools`, `mcp-auth`
- Covers: every tool happy path, auth rejection, rate limiting, not-found, validation errors

### Integration smoke test (`tests/integration/mcp-smoke.test.ts`)
- Hits the live deployed edge function URL
- Exercises: auth handshake, `list_projects`, `create_thread`, `get_my_profile`
- Requires: `MCP_SMOKE_URL`, `MCP_SMOKE_CLIENT_ID`, `MCP_SMOKE_SECRET` env vars
- Not run in CI — manual or post-deploy only

---

## 8. Configuration Reference

All env vars for `.env.example`:

```bash
# MCP Server — Admin keys
MCP_ACCESS_KEY=
MCP_ACCESS_KEYS=

# MCP Server — Per-agent clients
# JSON array: [{ "client_id": "claude", "secret": "...", "role": "agent", "disabled": false }]
MCP_CLIENTS_JSON=

# MCP Server — Rate limiting
MCP_RATE_LIMIT_RPM=120

# Integration smoke test
MCP_SMOKE_URL=
MCP_SMOKE_CLIENT_ID=
MCP_SMOKE_SECRET=
```

---

## 9. Connecting Agents

Once deployed, agents connect via HTTP transport:

```json
{
  "mcpServers": {
    "basecamp": {
      "type": "http",
      "url": "https://<project-ref>.supabase.co/functions/v1/basecamp-mcp",
      "headers": {
        "Authorization": "Bearer <secret>",
        "x-mcp-client-id": "claude"
      }
    }
  }
}
```
