# MCP File Download & Client Read Tools — Design Spec

**Date:** 2026-04-08
**Status:** Draft
**Parent spec:** `2026-03-26-supabase-mcp-server-design.md`

---

## 1. Purpose

Add three new tools to the basecamp-mcp Supabase edge function:

1. **`download_file`** — Download file content (base64 inline for ≤1MB) or get a temporary Dropbox URL (for >1MB).
2. **`list_clients`** — List all clients with name, code, domains, and archive status.
3. **`get_client`** — Get a single client by ID.

These fill two gaps in the current 15-tool MCP surface: agents can see file metadata but can't access file content, and agents have no visibility into clients at all.

---

## 2. New Tools

### 2.1 `download_file`

- **Input:** `file_id: uuid`
- **Behavior:**
  1. Looks up `project_files` row via existing `db.getFile()` to get `dropbox_path`, `dropbox_file_id`, `size_bytes`, `mime_type`, `filename`.
  2. Resolves Dropbox target: prefers `dropbox_file_id` when non-empty, falls back to `dropbox_path` (same logic as web app's download-link route).
  3. If `size_bytes <= 1,048,576` (1MB): downloads file via Dropbox REST API, returns:
     ```json
     { "filename": "...", "mime_type": "...", "size_bytes": 12345, "content_base64": "..." }
     ```
  4. If `size_bytes > 1,048,576`: gets a temporary download link, returns:
     ```json
     { "filename": "...", "mime_type": "...", "size_bytes": 5000000, "download_url": "...", "expires_in_seconds": 14400 }
     ```
- **Errors:** 404 if file not found in DB. Clear error if Dropbox credentials missing. Dropbox-specific errors mapped to safe messages (see Section 5).
- **File types:** Any — no restriction on mime type.

### 2.2 `list_clients`

- **Input:** none
- **Returns:** Array of `{ id, name, code, github_repos, domains, archived_at }` ordered by name ascending.
- **Access:** Read-only.

### 2.3 `get_client`

- **Input:** `client_id: uuid`
- **Returns:** Single client `{ id, name, code, github_repos, domains, archived_at }` or 404.
- **Access:** Read-only.

---

## 3. Dropbox Helper Module

**New file:** `supabase/functions/basecamp-mcp/dropbox.ts`

A minimal fetch-based Dropbox client (~60-80 lines). No Dropbox npm SDK — pure `fetch()` against the REST API.

### 3.1 Token Management

- Reads from `Deno.env`: `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`, `DROPBOX_REFRESH_TOKEN`
- Optional: `DROPBOX_SELECT_USER`, `DROPBOX_SELECT_ADMIN` (for team accounts)
- Refreshes access token via `POST https://api.dropbox.com/oauth2/token` with `grant_type=refresh_token`
- Module-level cache with expiry tracking (avoids double-refresh within a single request)

### 3.2 `getTemporaryLink(pathOrId: string): Promise<string>`

- `POST https://api.dropboxapi.com/2/files/get_temporary_link`
- Body: `{ "path": "<pathOrId>" }`
- Returns the `link` field from the response (valid ~4 hours)

### 3.3 `downloadFile(pathOrId: string): Promise<{ bytes: Uint8Array, contentType: string }>`

- `POST https://content.dropboxapi.com/2/files/download`
- Path specified via `Dropbox-API-Arg` header: `{ "path": "<pathOrId>" }`
- Returns raw bytes as `Uint8Array` and content type from response headers

### 3.4 Team Account Headers

When `DROPBOX_SELECT_USER` is set, all API requests include `Dropbox-API-Select-User: <value>`.
When `DROPBOX_SELECT_ADMIN` is set, all API requests include `Dropbox-API-Select-Admin: <value>`.

---

## 4. DB Layer Changes

**File:** `supabase/functions/basecamp-mcp/db.ts` — two new functions:

### `listClients(supabase)`

```sql
select id, name, code, github_repos, domains, archived_at
from clients
order by name asc
```

### `getClient(supabase, clientId)`

```sql
select id, name, code, github_repos, domains, archived_at
from clients
where id = $1
```

No new tables or migrations. `download_file` reuses the existing `getFile()` function.

---

## 5. Error Handling

### Dropbox Errors

| Dropbox condition | MCP response |
|---|---|
| Token refresh failure | `"Dropbox authentication failed"` |
| 409 `path/not_found` | `"File not found in storage"` |
| 429 rate limited | `"Storage rate limited, try again later"` |
| Other Dropbox error | `"Storage error"` |

Raw Dropbox error messages are **never** passed through — only the static strings above.

### Missing Credentials

If `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`, or `DROPBOX_REFRESH_TOKEN` are not set, `download_file` returns `"File download not configured — Dropbox credentials missing"`. Other tools remain unaffected.

### Size Boundary

Trust `size_bytes` from the DB to choose inline vs URL. No preflight HEAD request.

### Client Tools

Standard `notFound()` / `dbError()` pattern matching all existing tools.

---

## 6. Secret Safety

### Error messages
- Strip all Dropbox error details. Only return our static error strings.
- Token refresh failures must not leak `client_id`, `client_secret`, or `refresh_token`.

### Tool responses
- `download_file` returns `filename`, `mime_type`, `size_bytes`, `content_base64` or `download_url`. No `dropbox_path`, `dropbox_file_id`, or internal storage identifiers.
- Existing `get_file` tool already exposes `dropbox_path` / `dropbox_file_id` — no change.

### Dropbox helper module
- Access token is module-scoped, never logged, never returned.
- Credentials read once from `Deno.env.get()`, never included in any response or error.
- Explicit header construction — no risk of env vars leaking through debug dumps.

### Temporary download URLs
- Time-limited (~4 hours), single-file scoped, bearer URL. Same security model as the web app's existing download-link route. Acceptable since the agent already passed JWT auth.

### Tests
- Unit tests use fake placeholder credentials (`"fake-client-id"`, etc.)
- Integration smoke tests read credentials from env but never log or assert on values.

---

## 7. Testing Strategy

### Unit: `tests/unit/mcp-dropbox.test.ts` (new)

- Token refresh: mock fetch, verify OAuth2 body, verify cached token reuse
- `downloadFile`: mock fetch, verify `Dropbox-API-Arg` header, verify bytes returned
- `getTemporaryLink`: mock fetch, verify JSON body, verify link extracted
- Team headers: verify `Dropbox-API-Select-User` / `Dropbox-API-Select-Admin` headers when env vars set
- Error mapping: 409 → storage error, 429 → rate limit, auth failure → auth error
- Secret safety: verify no credentials in any error message

### Unit: `tests/unit/mcp-tools.test.ts` (extend existing)

- `download_file`: mock `db.getFile` + dropbox helper, verify base64 for ≤1MB, verify URL for >1MB, verify 404, verify error when Dropbox creds missing
- `list_clients`: mock `db.listClients`, verify response shape
- `get_client`: mock `db.getClient`, verify response and 404

### Integration: `tests/integration/mcp-smoke.test.ts` (extend existing)

- Add `list_clients` and `get_client` to tool call smoke sequence
- `download_file` only if a known test file exists, otherwise skip with message

---

## 8. Env Vars (Supabase Edge Function Secrets)

```bash
# Dropbox file access (same names as the Next.js app)
DROPBOX_CLIENT_ID=
DROPBOX_CLIENT_SECRET=
DROPBOX_REFRESH_TOKEN=
DROPBOX_SELECT_USER=        # optional, for team accounts
DROPBOX_SELECT_ADMIN=       # optional, for team accounts
```

Set via `supabase secrets set` or the Supabase dashboard.

---

## 9. File Summary

| File | Change |
|---|---|
| `supabase/functions/basecamp-mcp/dropbox.ts` | New — fetch-based Dropbox client |
| `supabase/functions/basecamp-mcp/db.ts` | Add `listClients`, `getClient` |
| `supabase/functions/basecamp-mcp/tools.ts` | Add `download_file`, `list_clients`, `get_client` |
| `tests/unit/mcp-dropbox.test.ts` | New — Dropbox helper unit tests |
| `tests/unit/mcp-tools.test.ts` | Extend — new tool tests |
| `tests/integration/mcp-smoke.test.ts` | Extend — smoke coverage |
