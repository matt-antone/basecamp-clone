# Email Notifications — Full Body Content & Subject Line Fix

**Date:** 2026-04-10  
**Status:** Approved

## Problem

Two issues with the current email notification system:

1. **Duplicate prefix in subject lines.** `buildProjectLabel` joins `[client_code, project_code, name]`, but `project_code` already includes the client prefix (canonical format: `CLIENTCODE-NNNN`). This produces subjects like `[JFLA-JFLA-0450-Website Changes] New comment on: JOB Plan` instead of `[JFLA-0450-Website Changes] New comment on: JOB Plan`.

2. **Truncated email body.** Comment notifications show a 180-character plain-text excerpt. Thread notifications include no body at all. Users cannot read the full content without opening the app.

## Scope

Both mailer call paths are affected:
- **Next.js app** (`lib/mailer.ts` ← `app/projects/[id]/threads/route.ts` and `comments/route.ts`)
- **Supabase MCP edge function** (`supabase/functions/basecamp-mcp/notify.ts` imports `lib/mailer.ts` directly)

## Approach

Inline a `markdownToEmailHtml()` helper in `lib/mailer.ts` using `marked` (already a dep in both `package.json` and `deno.json`). No `sanitize-html` needed — content is written by authenticated users into our own database, not arbitrary external input. Both environments pick up the change through the shared module.

## Design

### `lib/mailer.ts`

**Subject line fix — `buildProjectLabel`**

```typescript
// Before
const parts = [project.client_code, project.project_code, project.name].filter(Boolean);

// After
const parts = [project.project_code ?? project.client_code, project.name].filter(Boolean);
```

Uses `project_code` (which already contains the client prefix); falls back to `client_code` alone when `project_code` is null.

**New `markdownToEmailHtml()` helper**

```typescript
import { marked } from "marked";
marked.setOptions({ gfm: true, breaks: true });

function markdownToEmailHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
}
```

**Updated type signatures**

`ThreadEmailArgs.thread` gains `bodyMarkdown: string`.  
`CommentEmailArgs.comment.excerpt` renamed to `bodyMarkdown: string`.

**Updated email functions (all 4)**

- `sendThreadCreatedEmail` — embeds `markdownToEmailHtml(args.thread.bodyMarkdown)` in the HTML body
- `sendThreadUpdatedEmail` — same
- `sendCommentCreatedEmail` — replaces the blockquote excerpt with `markdownToEmailHtml(args.comment.bodyMarkdown)`
- `sendCommentUpdatedEmail` — same

`createCommentExcerpt` is no longer called. Remove its import from `comments/route.ts` and remove the function definition from `lib/mailer.ts`. If any test imports it directly, remove that test or replace it with a `markdownToEmailHtml` test.

### `supabase/functions/basecamp-mcp/notify.ts`

**Updated `NotifyEvent` type**

```typescript
| { type: "comment_created"; projectId: string; threadId: string; threadTitle: string; commentId: string; bodyMarkdown: string }
| { type: "comment_updated"; threadId: string; commentId: string; bodyMarkdown: string }
| { type: "thread_created";  projectId: string; threadId: string; threadTitle: string; bodyMarkdown: string }
| { type: "thread_updated";  projectId: string; threadId: string; threadTitle: string; bodyMarkdown: string }
| { type: "project_created"; projectId: string }
| { type: "project_updated"; projectId: string }
```

Switch cases pass `comment: { id, bodyMarkdown }` and `thread: { id, title, bodyMarkdown }` to the mailer.

### `supabase/functions/basecamp-mcp/tools.ts`

Four `safeNotify` call sites updated:

| Event | Before | After |
|---|---|---|
| `comment_created` | `excerpt: body_markdown.slice(0, 200)` | `bodyMarkdown: body_markdown` |
| `comment_updated` | `excerpt: body_markdown.slice(0, 200)` | `bodyMarkdown: body_markdown` |
| `thread_created` | no body field | `bodyMarkdown: body_markdown` (already in scope) |
| `thread_updated` | no body field | `bodyMarkdown: result.body_markdown ?? ""` (from DB result — covers partial patches where only title changes) |

No schema or DB changes required.

### Next.js route call sites

**`app/projects/[id]/threads/route.ts` (POST)**

```typescript
thread: {
  id: thread.id,
  title: thread.title,
  bodyMarkdown: payload.bodyMarkdown  // add
}
```

**`app/projects/[id]/threads/[threadId]/comments/route.ts` (POST)**

```typescript
comment: {
  id: comment.id,
  bodyMarkdown: payload.bodyMarkdown  // was: excerpt: createCommentExcerpt(payload.bodyMarkdown)
}
```

`sendThreadUpdatedEmail` and `sendCommentUpdatedEmail` are not called from Next.js routes — MCP only.

### `deno.json`

No changes needed. `marked` is already present as `"marked": "npm:marked"`.

## Tests

**`tests/unit/mailer.test.ts`**
- Replace `excerpt` fixture strings with `bodyMarkdown` markdown strings
- Assert rendered HTML appears in email bodies (e.g. `**bold**` → `<strong>bold</strong>`)
- Add test for `buildProjectLabel`: `project_code = "JFLA-0450"`, `name = "Website Changes"` → `JFLA-0450-Website Changes`

**`tests/unit/thread-route.test.ts`**
- Update assertions: `sendThreadCreatedEmail` receives `thread.bodyMarkdown`

**`tests/unit/thread-comment-route.test.ts`**
- Update assertions: `sendCommentCreatedEmail` receives `comment.bodyMarkdown` instead of `comment.excerpt`

Grep for any MCP notify/tools tests that assert on `excerpt` and update them.

## Constraints

- Email delivery remains best-effort — writes succeed even when notifications fail
- No env var changes
- No schema changes
- No new dependencies in either environment
