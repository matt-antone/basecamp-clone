# Email Notifications — Full Body Content & Subject Line Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix duplicate client prefix in email subject lines and replace truncated comment/thread excerpts with full markdown-rendered HTML bodies.

**Architecture:** Two isolated changes share one path: `buildProjectLabel` fix is a one-liner; `markdownToEmailHtml` is a private helper added to `lib/mailer.ts` that is picked up by both the Next.js app and the Supabase MCP edge function via the shared module. Type signatures cascade from `lib/mailer.ts` → `notify.ts` → `tools.ts` and the two Next.js routes.

**Tech Stack:** TypeScript, Next.js 15 App Router, Vitest, `marked` (already installed in both `package.json` and `deno.json`), Mailgun REST API via fetch.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `lib/mailer.ts` | Subject fix, `markdownToEmailHtml` helper, type changes, 4 email fn updates, remove `createCommentExcerpt` |
| Modify | `supabase/functions/basecamp-mcp/notify.ts` | `NotifyEvent` type: `excerpt` → `bodyMarkdown`, add `bodyMarkdown` to thread events; update switch cases |
| Modify | `supabase/functions/basecamp-mcp/tools.ts` | 4 `safeNotify` call sites: pass `bodyMarkdown` instead of `excerpt` slice |
| Modify | `app/projects/[id]/threads/route.ts` | Add `bodyMarkdown: payload.bodyMarkdown` to `thread` arg |
| Modify | `app/projects/[id]/threads/[threadId]/comments/route.ts` | Remove `createCommentExcerpt` import, pass `bodyMarkdown` directly |
| Modify | `tests/unit/mailer.test.ts` | Update fixture field names, add HTML body assertions, add label regression test |
| Modify | `tests/unit/thread-route.test.ts` | Assert `thread.bodyMarkdown` in email call |
| Modify | `tests/unit/thread-comment-route.test.ts` | Assert `comment.bodyMarkdown` instead of `comment.excerpt` |

---

## Task 1: Fix `buildProjectLabel` — eliminate duplicate client prefix

**Files:**
- Modify: `basecamp-clone/lib/mailer.ts:9` (one line change)
- Modify: `basecamp-clone/tests/unit/mailer.test.ts` (fixture updates + new regression test)

### Step 1: Write a failing regression test for the canonical `project_code` format

In `tests/unit/mailer.test.ts`, inside the `describe("mailer")` block, add a new test **before** the existing `sendCommentUpdatedEmail` test:

```typescript
it("buildProjectLabel: canonical project_code produces no duplicate prefix", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-label>" }) });
  const { sendThreadCreatedEmail } = await import("@/lib/mailer");
  await sendThreadCreatedEmail({
    recipients: [{ email: "a@example.com" }],
    actor: { name: "AI", email: "" },
    project: { id: "p-1", name: "Website Changes", project_code: "JFLA-0450" },
    thread: { id: "t-1", title: "Scope review" },
    threadUrl: "https://app.example.com/p-1/t-1",
  });
  const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
  expect(body.get("subject")).toBe("[JFLA-0450-Website Changes] New discussion: Scope review");
});
```

### Step 2: Run the new test — confirm it fails

```bash
cd basecamp-clone && npx vitest run tests/unit/mailer.test.ts --reporter=verbose 2>&1 | grep -A5 "buildProjectLabel"
```

Expected: FAIL — subject is `[JFLA-0450-Website Changes]` but got `[-JFLA-0450-Website Changes]` (empty client_code prepended) or similar.

### Step 3: Fix `buildProjectLabel` in `lib/mailer.ts`

Replace line 9 (the `parts` assignment inside `buildProjectLabel`):

```typescript
// Before (line 9)
const parts = [project.client_code, project.project_code, project.name].filter(Boolean);

// After
const parts = [project.project_code ?? project.client_code, project.name].filter(Boolean);
```

### Step 4: Update existing test fixtures to use canonical `project_code`

The four existing tests that pass `client_code: "AC", project_code: "0001"` used a non-canonical format that only worked because the old implementation concatenated both. Update them to pass `project_code: "AC-0001"` and drop `client_code`:

In `tests/unit/mailer.test.ts`, find each of these four tests and update the `project` object:

**`sendCommentUpdatedEmail` test (was: `client_code: "AC", project_code: "0001"`):**
```typescript
project: { id: "p-1", name: "Acme Site", project_code: "AC-0001" },
```

**`sendThreadUpdatedEmail` test (same change):**
```typescript
project: { id: "p-1", name: "Acme Site", project_code: "AC-0001" },
```

**`sendProjectCreatedEmail` test (same change):**
```typescript
project: { id: "p-1", name: "Acme Site", project_code: "AC-0001" },
```

**`sendProjectUpdatedEmail` test (same change):**
```typescript
project: { id: "p-1", name: "Acme Site", project_code: "AC-0001" },
```

The subject assertions (`[AC-0001-Acme Site] ...`) do not change.

### Step 5: Run all mailer tests — confirm pass

```bash
cd basecamp-clone && npx vitest run tests/unit/mailer.test.ts --reporter=verbose
```

Expected: all tests PASS.

### Step 6: Commit

```bash
cd basecamp-clone && git add lib/mailer.ts tests/unit/mailer.test.ts
git commit -m "fix(mailer): deduplicate client prefix in buildProjectLabel subject line"
```

---

## Task 2: Add `markdownToEmailHtml` + update types + update 4 email functions

**Files:**
- Modify: `basecamp-clone/lib/mailer.ts` (add import, helper, update types, update 4 send* functions, delete `createCommentExcerpt`)
- Modify: `basecamp-clone/tests/unit/mailer.test.ts` (update `excerpt` fixtures → `bodyMarkdown`, add HTML assertions)

### Step 1: Update `mailer.test.ts` — change fixtures and add HTML assertions

**Update the `sendCommentUpdatedEmail` test** to use `bodyMarkdown` and assert the HTML body contains rendered markdown:

```typescript
it("sendCommentUpdatedEmail: subject contains [label] and thread title", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-1>" }) });
  const { sendCommentUpdatedEmail } = await import("@/lib/mailer");
  const result = await sendCommentUpdatedEmail({
    recipients: [{ email: "a@example.com" }],
    actor: { name: "AI", email: "" },
    project: { id: "p-1", name: "Acme Site", project_code: "AC-0001" },
    thread: { id: "t-1", title: "Design Review" },
    threadUrl: "https://app.example.com/p-1/t-1",
    comment: { id: "c-1", bodyMarkdown: "**Looks good** to me" },
  });
  expect(result).toMatchObject({ skipped: false, recipientCount: 1 });
  const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
  expect(body.get("subject")).toBe("[AC-0001-Acme Site] Comment updated on: Design Review");
  expect(body.get("html")).toContain("<strong>Looks good</strong>");
});
```

**Add a `sendThreadCreatedEmail` HTML body assertion** to the existing thread email test (after the `text` assertion at line 71):

```typescript
expect(body.get("html")).toContain("<strong>Opening post</strong>");
```

And update the `sendThreadCreatedEmail` call args to include `thread.bodyMarkdown`:

```typescript
thread: { id: "thread-1", title: "Kickoff notes", bodyMarkdown: "**Opening post**" },
```

### Step 2: Run tests — confirm they fail

```bash
cd basecamp-clone && npx vitest run tests/unit/mailer.test.ts --reporter=verbose
```

Expected: FAIL — TypeScript error or runtime assertion failure on `excerpt` vs `bodyMarkdown`.

### Step 3: Update `lib/mailer.ts` — add helper, update types, update functions, delete `createCommentExcerpt`

**3a. Add import at top of file (after the existing `import { config }` line):**

```typescript
import { marked } from "marked";
```

**3b. Add `markdownToEmailHtml` helper after `buildProjectLabel`:**

```typescript
marked.setOptions({ gfm: true, breaks: true });

function markdownToEmailHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
}
```

**3c. Update `ThreadEmailArgs` — add `bodyMarkdown` to `thread`:**

```typescript
type ThreadEmailArgs = {
  recipients: MailRecipient[];
  actor: {
    name: string;
    email: string;
  };
  project: {
    id: string;
    name: string;
    client_code?: string | null;
    project_code?: string | null;
  };
  thread: {
    id: string;
    title: string;
    bodyMarkdown: string;
  };
  threadUrl: string;
};
```

**3d. Update `CommentEmailArgs` — rename `excerpt` to `bodyMarkdown`:**

```typescript
type CommentEmailArgs = ThreadEmailArgs & {
  comment: {
    id: string;
    bodyMarkdown: string;
  };
};
```

**3e. Delete the `createCommentExcerpt` function** (lines 80–92 in the original file). Remove the entire function body.

**3f. Update `sendThreadCreatedEmail`** — embed HTML body:

```typescript
export async function sendThreadCreatedEmail(args: ThreadEmailArgs) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] New discussion: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedThreadUrl = escapeHtml(args.threadUrl);
  const bodyHtml = markdownToEmailHtml(args.thread.bodyMarkdown);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} started a new discussion in ${args.project.name}.`,
      "",
      `Thread: ${args.thread.title}`,
      "",
      args.thread.bodyMarkdown,
      "",
      `Open: ${args.threadUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> started a new discussion in <strong>${escapedProjectName}</strong>.</p>`,
      `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
      bodyHtml,
      `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
      "</div>"
    ].join("")
  });
}
```

**3g. Update `sendThreadUpdatedEmail`** — embed HTML body:

```typescript
export async function sendThreadUpdatedEmail(args: ThreadEmailArgs) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] Discussion updated: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedThreadUrl = escapeHtml(args.threadUrl);
  const bodyHtml = markdownToEmailHtml(args.thread.bodyMarkdown);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} updated a discussion in ${args.project.name}.`,
      "",
      `Thread: ${args.thread.title}`,
      "",
      args.thread.bodyMarkdown,
      "",
      `Open: ${args.threadUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> updated a discussion in <strong>${escapedProjectName}</strong>.</p>`,
      `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
      bodyHtml,
      `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
      "</div>"
    ].join("")
  });
}
```

**3h. Update `sendCommentCreatedEmail`** — replace excerpt block with HTML body:

```typescript
export async function sendCommentCreatedEmail(args: CommentEmailArgs) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] New comment on: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedThreadUrl = escapeHtml(args.threadUrl);
  const bodyHtml = markdownToEmailHtml(args.comment.bodyMarkdown);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} commented on a discussion in ${args.project.name}.`,
      "",
      `Thread: ${args.thread.title}`,
      "",
      args.comment.bodyMarkdown,
      "",
      `Open: ${args.threadUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> commented on a discussion in <strong>${escapedProjectName}</strong>.</p>`,
      `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
      bodyHtml,
      `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
      "</div>"
    ].join("")
  });
}
```

**3i. Update `sendCommentUpdatedEmail`** — replace excerpt block with HTML body:

```typescript
export async function sendCommentUpdatedEmail(args: CommentEmailArgs) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] Comment updated on: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedThreadUrl = escapeHtml(args.threadUrl);
  const bodyHtml = markdownToEmailHtml(args.comment.bodyMarkdown);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} updated a comment in ${args.project.name}.`,
      "",
      `Thread: ${args.thread.title}`,
      "",
      args.comment.bodyMarkdown,
      "",
      `Open: ${args.threadUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> updated a comment in <strong>${escapedProjectName}</strong>.</p>`,
      `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
      bodyHtml,
      `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
      "</div>"
    ].join("")
  });
}
```

### Step 4: Run mailer tests — confirm pass

```bash
cd basecamp-clone && npx vitest run tests/unit/mailer.test.ts --reporter=verbose
```

Expected: all tests PASS.

### Step 5: Commit

```bash
cd basecamp-clone && git add lib/mailer.ts tests/unit/mailer.test.ts
git commit -m "feat(mailer): add markdownToEmailHtml, embed full body in thread/comment emails, remove createCommentExcerpt"
```

---

## Task 3: Update Next.js comments route

**Files:**
- Modify: `basecamp-clone/app/projects/[id]/threads/[threadId]/comments/route.ts:2,118-121`
- Modify: `basecamp-clone/tests/unit/thread-comment-route.test.ts:82-93`

### Step 1: Update `thread-comment-route.test.ts` — change `comment.excerpt` → `comment.bodyMarkdown`

In the `"returns 201 and sends email when comment creation succeeds"` test, update the `sendCommentCreatedEmailMock` assertion (lines 82–93):

```typescript
expect(sendCommentCreatedEmailMock).toHaveBeenCalledWith(
  expect.objectContaining({
    actor: { name: "Alex Author", email: "author@example.com" },
    project: expect.objectContaining({ id: "project-1", name: "Blue Sky" }),
    thread: expect.objectContaining({ id: "thread-1", title: "Kickoff notes" }),
    recipients: [{ email: "jamie@example.com", name: "Jamie Teammate" }],
    comment: {
      id: "comment-1",
      bodyMarkdown: "This is a thoughtful follow-up comment."
    }
  })
);
```

### Step 2: Run test — confirm it fails

```bash
cd basecamp-clone && npx vitest run tests/unit/thread-comment-route.test.ts --reporter=verbose 2>&1 | grep -A10 "sends email"
```

Expected: FAIL — received `comment.excerpt`, expected `comment.bodyMarkdown`.

### Step 3: Update `comments/route.ts`

**Remove `createCommentExcerpt` from the import** (line 2):

```typescript
// Before
import { createCommentExcerpt, sendCommentCreatedEmail } from "@/lib/mailer";

// After
import { sendCommentCreatedEmail } from "@/lib/mailer";
```

**Replace the `comment` arg** in the `sendCommentCreatedEmail` call (lines 118–121):

```typescript
// Before
comment: {
  id: comment.id,
  excerpt: createCommentExcerpt(payload.bodyMarkdown)
},

// After
comment: {
  id: comment.id,
  bodyMarkdown: payload.bodyMarkdown
},
```

Also update the `thread` arg to include `bodyMarkdown` (the thread body is not in scope here — pass empty string since comment emails only show the comment body, not the thread body):

Wait — `ThreadEmailArgs` now requires `thread.bodyMarkdown`. But in the comments route, the thread object comes from `getThread()` which returns `{ id, title }`. We need to extend the thread fetch or pass an empty string. Per the spec, only the comment body appears in comment emails — the thread body is not shown. Pass `bodyMarkdown: ""` for the thread field since comment email rendering only uses `args.comment.bodyMarkdown`.

```typescript
thread: {
  id: threadId,
  title: thread.title,
  bodyMarkdown: ""
},
```

### Step 4: Run test — confirm pass

```bash
cd basecamp-clone && npx vitest run tests/unit/thread-comment-route.test.ts --reporter=verbose
```

Expected: all tests PASS.

### Step 5: Commit

```bash
cd basecamp-clone && git add "app/projects/[id]/threads/[threadId]/comments/route.ts" tests/unit/thread-comment-route.test.ts
git commit -m "fix(comments-route): pass full bodyMarkdown to comment email, remove createCommentExcerpt"
```

---

## Task 4: Update Next.js threads route

**Files:**
- Modify: `basecamp-clone/app/projects/[id]/threads/route.ts:113-119`
- Modify: `basecamp-clone/tests/unit/thread-route.test.ts:75-82`

### Step 1: Update `thread-route.test.ts` — add `bodyMarkdown` to thread assertion

In the `"returns 201 and sends email when thread creation succeeds"` test, update the `thread` field in the `sendThreadCreatedEmailMock` assertion (line 78):

```typescript
thread: { id: "thread-1", title: "Kickoff notes", bodyMarkdown: "Opening post" },
```

### Step 2: Run test — confirm it fails

```bash
cd basecamp-clone && npx vitest run tests/unit/thread-route.test.ts --reporter=verbose 2>&1 | grep -A10 "sends email"
```

Expected: FAIL — received `thread` without `bodyMarkdown`.

### Step 3: Update `threads/route.ts` — add `bodyMarkdown` to thread arg

In the `sendThreadCreatedEmail` call (around line 99), update the `thread` field:

```typescript
thread: {
  id: thread.id,
  title: thread.title,
  bodyMarkdown: payload.bodyMarkdown
},
```

### Step 4: Run test — confirm pass

```bash
cd basecamp-clone && npx vitest run tests/unit/thread-route.test.ts --reporter=verbose
```

Expected: all tests PASS.

### Step 5: Commit

```bash
cd basecamp-clone && git add "app/projects/[id]/threads/route.ts" tests/unit/thread-route.test.ts
git commit -m "fix(threads-route): pass full bodyMarkdown to thread email"
```

---

## Task 5: Update MCP `notify.ts` + `tools.ts` + full test run

**Files:**
- Modify: `basecamp-clone/supabase/functions/basecamp-mcp/notify.ts:14-20,64-108`
- Modify: `basecamp-clone/supabase/functions/basecamp-mcp/tools.ts:259,284,309,329`

### Step 1: Update `NotifyEvent` type in `notify.ts`

Replace lines 14–20:

```typescript
export type NotifyEvent =
  | { type: "comment_created"; projectId: string; threadId: string; threadTitle: string; commentId: string; bodyMarkdown: string }
  | { type: "comment_updated"; threadId: string; commentId: string; bodyMarkdown: string }
  | { type: "thread_created";  projectId: string; threadId: string; threadTitle: string; bodyMarkdown: string }
  | { type: "thread_updated";  projectId: string; threadId: string; threadTitle: string; bodyMarkdown: string }
  | { type: "project_created"; projectId: string }
  | { type: "project_updated"; projectId: string };
```

### Step 2: Update switch cases in `notify.ts`

**`comment_created` case** — change `excerpt` to `bodyMarkdown`:

```typescript
case "comment_created": {
  await sendCommentCreatedEmail({
    recipients,
    actor,
    project,
    thread: { id: event.threadId, title: event.threadTitle, bodyMarkdown: "" },
    threadUrl: `${appUrl}/${resolvedProjectId}/${event.threadId}`,
    comment: { id: event.commentId, bodyMarkdown: event.bodyMarkdown },
  });
  break;
}
```

**`comment_updated` case** — change `excerpt` to `bodyMarkdown`:

```typescript
case "comment_updated": {
  const thread = await threadP;
  if (!thread) return;
  await sendCommentUpdatedEmail({
    recipients,
    actor,
    project,
    thread: { id: thread.id, title: thread.title, bodyMarkdown: "" },
    threadUrl: `${appUrl}/${resolvedProjectId}/${thread.id}`,
    comment: { id: event.commentId, bodyMarkdown: event.bodyMarkdown },
  });
  break;
}
```

**`thread_created` case** — add `bodyMarkdown`:

```typescript
case "thread_created": {
  await sendThreadCreatedEmail({
    recipients,
    actor,
    project,
    thread: { id: event.threadId, title: event.threadTitle, bodyMarkdown: event.bodyMarkdown },
    threadUrl: `${appUrl}/${resolvedProjectId}/${event.threadId}`,
  });
  break;
}
```

**`thread_updated` case** — add `bodyMarkdown`:

```typescript
case "thread_updated": {
  await sendThreadUpdatedEmail({
    recipients,
    actor,
    project,
    thread: { id: event.threadId, title: event.threadTitle, bodyMarkdown: event.bodyMarkdown },
    threadUrl: `${appUrl}/${resolvedProjectId}/${event.threadId}`,
  });
  break;
}
```

### Step 3: Update 4 `safeNotify` call sites in `tools.ts`

**Line 259 — `thread_created`:**

```typescript
safeNotify({ type: "thread_created", projectId: result.project_id, threadId: result.id, threadTitle: result.title, bodyMarkdown: body_markdown });
```

**Line 284 — `thread_updated`:**

```typescript
safeNotify({ type: "thread_updated", projectId: result.project_id, threadId: result.id, threadTitle: result.title ?? title ?? "", bodyMarkdown: result.body_markdown ?? "" });
```

**Line 309 — `comment_created`:**

```typescript
safeNotify({ type: "comment_created", projectId: thread.thread.project_id, threadId: thread_id, threadTitle: thread.thread.title, commentId: result.id, bodyMarkdown: body_markdown });
```

**Line 329 — `comment_updated`:**

```typescript
safeNotify({ type: "comment_updated", threadId: result.thread_id, commentId: result.id, bodyMarkdown: body_markdown });
```

### Step 4: Run full test suite — confirm all pass

```bash
cd basecamp-clone && npm run test
```

Expected: all tests PASS, no TypeScript errors.

### Step 5: Commit

```bash
cd basecamp-clone && git add supabase/functions/basecamp-mcp/notify.ts supabase/functions/basecamp-mcp/tools.ts
git commit -m "feat(mcp): propagate full bodyMarkdown through notify events, drop excerpt truncation"
```

---

## Self-Review

**Spec coverage:**
- [x] `buildProjectLabel` fix — Task 1
- [x] `markdownToEmailHtml` helper — Task 2
- [x] `ThreadEmailArgs.thread.bodyMarkdown` added — Task 2
- [x] `CommentEmailArgs.comment.excerpt` renamed to `bodyMarkdown` — Task 2
- [x] All 4 send* functions updated — Task 2
- [x] `createCommentExcerpt` removed — Task 2 (deleted from mailer) + Task 3 (import removed from route)
- [x] `sendThreadCreatedEmail` gets `bodyMarkdown` from Next.js route — Task 4
- [x] `sendCommentCreatedEmail` gets `bodyMarkdown` from Next.js route — Task 3
- [x] `NotifyEvent` type updated — Task 5
- [x] MCP tools 4 call sites updated — Task 5
- [x] `tests/unit/mailer.test.ts` updated — Tasks 1 + 2
- [x] `tests/unit/thread-route.test.ts` updated — Task 4
- [x] `tests/unit/thread-comment-route.test.ts` updated — Task 3

**Placeholder scan:** No TBDs, TODOs, or "similar to Task N" references.

**Type consistency:**
- `bodyMarkdown` used consistently across `ThreadEmailArgs.thread`, `CommentEmailArgs.comment`, `NotifyEvent` variants, and all call sites.
- `markdownToEmailHtml` defined in Task 2 and called by all 4 email functions.
- `createCommentExcerpt` removed from mailer in Task 2, import removed from route in Task 3.
