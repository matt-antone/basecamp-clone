# MCP Email Notifications Design

**Date:** 2026-04-07  
**Status:** Approved  

## Overview

When the AI agent uses the Basecamp MCP to create or update content, workspace members receive the same email notifications they would get from a human making the same change via the web UI. Notifications are best-effort: the tool call succeeds regardless of whether the email send succeeds.

## Scope

All six write tools trigger notifications:

| Tool | Event type | Email function |
|---|---|---|
| `create_comment` | `comment_created` | `sendCommentCreatedEmail` (existing) |
| `create_thread` | `thread_created` | `sendThreadCreatedEmail` (existing) |
| `update_comment` | `comment_updated` | `sendCommentUpdatedEmail` (new) |
| `update_thread` | `thread_updated` | `sendThreadUpdatedEmail` (new) |
| `create_project` | `project_created` | `sendProjectCreatedEmail` (new) |
| `update_project` | `project_updated` | `sendProjectUpdatedEmail` (new) |

Read tools (`list_projects`, `get_project`, `get_thread`, `list_files`, `get_file`, `search_content`), `create_file`, and profile tools do not trigger notifications.

## Architecture

```
tools.ts (write tool handler)
  │
  ├── db.createComment / updateComment / etc.   ← existing DB write
  │
  └── notifyBestEffort(supabase, agent, event)  ← fire-and-forget, no await
        │
        ├── db.getProjectForNotification(supabase, projectId)
        │     → { id, name, project_code, client_code }
        │
        ├── db.listNotificationRecipients(supabase)
        │     → active user_profiles matching WORKSPACE_DOMAIN
        │
        ├── db.getProfile(supabase, agent.client_id)
        │     → { name: "AI", ... }
        │
        ├── [comment_updated only]
        │   db.getThreadForNotification(supabase, threadId)
        │     → { id, title, project_id }
        │
        └── sendXxxEmail(...)  ← imported from ../../../lib/mailer.ts
```

### Key design decisions

- **Shared mailer:** `lib/mailer.ts` is imported directly into the Edge Function via relative path (`../../../lib/mailer.ts`), following the same pattern already used for `lib/project-status.ts`. No code duplication for the send/template logic.
- **Separate recipient query:** `lib/repositories.ts` uses the Node.js `pg` client and cannot run in Deno. Recipient fetching is reimplemented in `db.ts` using the Supabase JS client already present in the Edge Function.
- **Fire and forget:** `notifyBestEffort` is called without `await`. The tool returns its result immediately; notification runs in the background.
- **Actor identity:** The agent's `name` field from `agent_profiles` is used as the actor name in email bodies (defaults to `"AI"` if the profile fetch fails). Agent profiles have no email address; `actor.email` is passed as `""`.

## New env var

| Variable | Where set | Purpose |
|---|---|---|
| `APP_URL` | Supabase secret | Base URL for building email links, e.g. `https://pm.yourdomain.com` |

`WORKSPACE_DOMAIN` and Mailgun vars are already required Supabase secrets.

## Files changed

### `lib/mailer.ts` — 4 new sender functions + 1 new arg type

**New type:**
```typescript
type ProjectEmailArgs = {
  recipients: MailRecipient[];
  actor: { name: string; email: string };
  project: { id: string; name: string; client_code?: string | null; project_code?: string | null };
  projectUrl: string;
}
```

**New functions and their subjects:**

| Function | Subject |
|---|---|
| `sendCommentUpdatedEmail(args: CommentEmailArgs)` | `[GX-0001-Project] Comment updated on: Thread title` |
| `sendThreadUpdatedEmail(args: ThreadEmailArgs)` | `[GX-0001-Project] Discussion updated: Thread title` |
| `sendProjectCreatedEmail(args: ProjectEmailArgs)` | `[GX-0001-Project] New project created` |
| `sendProjectUpdatedEmail(args: ProjectEmailArgs)` | `[GX-0001-Project] Project updated: Project name` |

All four follow the same pattern as the existing functions: build subject via `buildProjectLabel`, call `sendMail`, return `SendMailResult`.

### `supabase/functions/basecamp-mcp/db.ts` — 3 new query functions

**`getProjectForNotification(supabase, projectId)`**
```sql
SELECT p.id, p.name, p.project_code, c.code AS client_code
FROM projects p
LEFT JOIN clients c ON c.id = p.client_id
WHERE p.id = $projectId
```
Returns `{ id, name, project_code, client_code } | null`.

**`listNotificationRecipients(supabase)`**
```
SELECT email, first_name, last_name
FROM user_profiles
WHERE active = true AND email ILIKE '%@' + WORKSPACE_DOMAIN
```
Reads `WORKSPACE_DOMAIN` from `Deno.env.get("WORKSPACE_DOMAIN")`.  
Returns `MailRecipient[]`.

**`getThreadForNotification(supabase, threadId)`**
```sql
SELECT id, title, project_id FROM discussion_threads WHERE id = $threadId
```
Returns `{ id, title, project_id } | null`. Used only for `comment_updated` to resolve thread title and project.

### `supabase/functions/basecamp-mcp/notify.ts` — new file

**Event union:**
```typescript
type NotifyEvent =
  | { type: "comment_created"; projectId: string; threadId: string; threadTitle: string; commentId: string; excerpt: string }
  | { type: "comment_updated"; threadId: string; commentId: string; excerpt: string }
  | { type: "thread_created";  projectId: string; threadId: string; threadTitle: string }
  | { type: "thread_updated";  projectId: string; threadId: string; threadTitle: string }
  | { type: "project_created"; projectId: string }
  | { type: "project_updated"; projectId: string }
```

**`notifyBestEffort(supabase, agent, event)` flow:**
1. Fetch recipients, agent profile, and project info in parallel (where available)
2. For `comment_updated`: additionally fetch thread via `getThreadForNotification`
3. Skip silently if recipient list is empty
4. Call the appropriate `sendXxxEmail` from `lib/mailer.ts`
5. On any error: `console.error("mcp_notification_failed", { type: event.type, error: String(e) })` — never rethrows
6. On success: `console.info("mcp_notification_sent", { type: event.type, recipientCount })`

**URL construction:**
- Thread/comment events: `` `${APP_URL}/${projectId}/${threadId}` ``
- Project events: `` `${APP_URL}/${projectId}` ``

`APP_URL` read from `Deno.env.get("APP_URL")`.

### `supabase/functions/basecamp-mcp/tools.ts` — wire up notifications

Each write tool calls `notifyBestEffort` after a successful DB write. The call is not awaited. Notification is not attempted when the DB write returns null (those paths return early via `notFound()`).

**`create_comment`** — passes `projectId`, `threadId`, `threadTitle` from the already-fetched thread object; `excerpt` from `body_markdown.slice(0, 200)`.

**`create_thread`** — passes `projectId` from tool args; `threadId` and `threadTitle` from the created thread result.

**`update_comment`** — passes `threadId` from the updated comment row (`result.thread_id`); `excerpt` from `body_markdown.slice(0, 200)`. `projectId` and `threadTitle` are resolved inside `notifyBestEffort` via `getThreadForNotification`.

**`update_thread`** — passes `projectId` from the updated thread row (`result.project_id`); `threadId` from tool args; `threadTitle` from `result.title ?? patch.title`.

**`create_project`** and **`update_project`** — pass `projectId` from the result row (`result.id`).

## Testing

### `tests/unit/mcp-write-tools.test.ts` (extend existing)
- Each write tool calls `notifyBestEffort` with the correct event shape on success
- `notifyBestEffort` is not called when the DB write returns null
- Tool returns 200/success even when `notifyBestEffort` throws

### `tests/unit/mcp-notify.test.ts` (new)
- Calls the correct mailer function for each of the 6 event types
- Skips send and logs when recipient list is empty
- Catches and logs mailer errors without rethrowing
- Falls back to actor name `"AI"` when `getProfile` returns null

### `tests/unit/mailer.test.ts` (extend existing)
- One test per new sender function asserting subject format and body content
- Covers `ProjectEmailArgs` path (no thread)

### Integration tests
`tests/integration/mcp-smoke.test.ts` is not expanded. Email is best-effort and does not gate integration correctness.

## Change hygiene notes

- No schema migrations required.
- One new Supabase secret required: `APP_URL`.
- `lib/mailer.ts` changes are backward-compatible; no existing callers affected.
- The `actor.email` field is `""` for agent-originated emails — not rendered in templates, type-safe.
