# MCP Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire email notifications into all 6 MCP write tools so that workspace members receive emails when an AI agent creates or updates content.

**Architecture:** A new `notify.ts` file in the Edge Function provides a fire-and-forget `notifyBestEffort` function. Each write tool calls it (without `await`) after a successful DB write. `notify.ts` fetches recipients and project info via new `db.ts` helpers, then delegates to existing/new `lib/mailer.ts` functions.

**Tech Stack:** Deno (Edge Function), Supabase JS client, existing Mailgun-based `lib/mailer.ts`, Vitest for tests.

**Status: COMPLETE** — All tasks implemented and verified with live email delivery on 2026-04-08.

### Post-plan fixes (2026-04-08)
- Split `lib/config.ts` into `lib/config-core.ts` (runtime-agnostic) + `lib/config.ts` (server-only re-export) so `mailer.ts` works in both Node.js and Deno.
- Replaced `Buffer.from().toString("base64")` with `btoa()` for cross-runtime compatibility.
- Removed `workspaceDomain` filtering from `listNotificationRecipients` — MCP is already secured via JWT auth, domain filtering was redundant and required an env var not set in the edge function.

---

## File Map

| Action | Path |
|--------|------|
| Modify | `lib/mailer.ts` |
| Modify | `supabase/functions/basecamp-mcp/db.ts` |
| Create | `supabase/functions/basecamp-mcp/notify.ts` |
| Modify | `supabase/functions/basecamp-mcp/tools.ts` |
| Modify | `tests/unit/mailer.test.ts` |
| Modify | `tests/unit/mcp-write-tools.test.ts` |
| Create | `tests/unit/mcp-notify.test.ts` |

---

### Task 1: Add 4 new sender functions to `lib/mailer.ts`

**Files:**
- Modify: `lib/mailer.ts`
- Test: `tests/unit/mailer.test.ts`

- [x] **Step 1: Write failing tests for the 4 new functions**

Add to `tests/unit/mailer.test.ts` (inside the existing `describe("mailer", ...)` block, after the existing tests):

```typescript
it("sendCommentUpdatedEmail: subject contains [label] and thread title", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-1>" }) });
  const { sendCommentUpdatedEmail } = await import("@/lib/mailer");
  const result = await sendCommentUpdatedEmail({
    recipients: [{ email: "a@example.com" }],
    actor: { name: "AI", email: "" },
    project: { id: "p-1", name: "Acme Site", client_code: "AC", project_code: "0001" },
    thread: { id: "t-1", title: "Design Review" },
    threadUrl: "https://app.example.com/p-1/t-1",
    comment: { id: "c-1", excerpt: "Looks good to me" },
  });
  expect(result).toMatchObject({ skipped: false, recipientCount: 1 });
  const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
  expect(body.get("subject")).toBe("[AC-0001-Acme Site] Comment updated on: Design Review");
});

it("sendThreadUpdatedEmail: subject contains [label] and thread title", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-2>" }) });
  const { sendThreadUpdatedEmail } = await import("@/lib/mailer");
  const result = await sendThreadUpdatedEmail({
    recipients: [{ email: "a@example.com" }],
    actor: { name: "AI", email: "" },
    project: { id: "p-1", name: "Acme Site", client_code: "AC", project_code: "0001" },
    thread: { id: "t-1", title: "Design Review" },
    threadUrl: "https://app.example.com/p-1/t-1",
  });
  expect(result).toMatchObject({ skipped: false, recipientCount: 1 });
  const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
  expect(body.get("subject")).toBe("[AC-0001-Acme Site] Discussion updated: Design Review");
});

it("sendProjectCreatedEmail: subject contains [label] and 'New project created'", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-3>" }) });
  const { sendProjectCreatedEmail } = await import("@/lib/mailer");
  const result = await sendProjectCreatedEmail({
    recipients: [{ email: "a@example.com" }],
    actor: { name: "AI", email: "" },
    project: { id: "p-1", name: "Acme Site", client_code: "AC", project_code: "0001" },
    projectUrl: "https://app.example.com/p-1",
  });
  expect(result).toMatchObject({ skipped: false, recipientCount: 1 });
  const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
  expect(body.get("subject")).toBe("[AC-0001-Acme Site] New project created");
});

it("sendProjectUpdatedEmail: subject contains [label] and project name", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-4>" }) });
  const { sendProjectUpdatedEmail } = await import("@/lib/mailer");
  const result = await sendProjectUpdatedEmail({
    recipients: [{ email: "a@example.com" }],
    actor: { name: "AI", email: "" },
    project: { id: "p-1", name: "Acme Site", client_code: "AC", project_code: "0001" },
    projectUrl: "https://app.example.com/p-1",
  });
  expect(result).toMatchObject({ skipped: false, recipientCount: 1 });
  const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
  expect(body.get("subject")).toBe("[AC-0001-Acme Site] Project updated: Acme Site");
});
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/mailer.test.ts
```

Expected: 4 new tests fail with "sendCommentUpdatedEmail is not a function" (or similar).

- [x] **Step 3: Add `ProjectEmailArgs` type and 4 new functions to `lib/mailer.ts`**

Add after the `CommentEmailArgs` type definition (around line 37):

```typescript
type ProjectEmailArgs = {
  recipients: MailRecipient[];
  actor: { name: string; email: string };
  project: { id: string; name: string; client_code?: string | null; project_code?: string | null };
  projectUrl: string;
};
```

Add after `sendCommentCreatedEmail` (at the end of the file):

```typescript
export async function sendCommentUpdatedEmail(args: CommentEmailArgs) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] Comment updated on: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedExcerpt = escapeHtml(args.comment.excerpt);
  const escapedThreadUrl = escapeHtml(args.threadUrl);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} updated a comment in ${args.project.name}.`,
      "",
      `Thread: ${args.thread.title}`,
      `Comment: ${args.comment.excerpt}`,
      `Open: ${args.threadUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> updated a comment in <strong>${escapedProjectName}</strong>.</p>`,
      `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
      `<p style="padding: 12px; border-left: 3px solid #d1d5db; background: #f9fafb;">${escapedExcerpt}</p>`,
      `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
      "</div>"
    ].join("")
  });
}

export async function sendThreadUpdatedEmail(args: ThreadEmailArgs) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] Discussion updated: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedThreadUrl = escapeHtml(args.threadUrl);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} updated a discussion in ${args.project.name}.`,
      "",
      `Thread: ${args.thread.title}`,
      `Open: ${args.threadUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> updated a discussion in <strong>${escapedProjectName}</strong>.</p>`,
      `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
      `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
      "</div>"
    ].join("")
  });
}

export async function sendProjectCreatedEmail(args: ProjectEmailArgs) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] New project created`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedProjectUrl = escapeHtml(args.projectUrl);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} created a new project: ${args.project.name}.`,
      "",
      `Open: ${args.projectUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> created a new project: <strong>${escapedProjectName}</strong>.</p>`,
      `<p><a href="${escapedProjectUrl}">Open project</a></p>`,
      "</div>"
    ].join("")
  });
}

export async function sendProjectUpdatedEmail(args: ProjectEmailArgs) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] Project updated: ${args.project.name}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedProjectUrl = escapeHtml(args.projectUrl);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} updated project: ${args.project.name}.`,
      "",
      `Open: ${args.projectUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> updated project: <strong>${escapedProjectName}</strong>.</p>`,
      `<p><a href="${escapedProjectUrl}">Open project</a></p>`,
      "</div>"
    ].join("")
  });
}
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/mailer.test.ts
```

Expected: All tests pass.

- [x] **Step 5: Commit**

```bash
git add lib/mailer.ts tests/unit/mailer.test.ts
git commit -m "feat: add sendCommentUpdatedEmail, sendThreadUpdatedEmail, sendProjectCreatedEmail, sendProjectUpdatedEmail"
```

---

### Task 2: Add 3 notification query helpers to `db.ts`

**Files:**
- Modify: `supabase/functions/basecamp-mcp/db.ts`

No isolated tests here — these helpers are tested indirectly via `mcp-notify.test.ts` in Task 4. They follow the exact same patterns as `getProfile` and `getThread` already in this file.

- [x] **Step 1: Add 3 functions at the end of `supabase/functions/basecamp-mcp/db.ts`**

```typescript
// ─── Notification helpers ─────────────────────────────────────────────────────

export async function getProjectForNotification(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ id: string; name: string; project_code: string | null; client_code: string | null } | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, project_code, clients(code)")
    .eq("id", projectId)
    .single();
  if (error || !data) return null;
  return {
    id: data.id,
    name: data.name,
    project_code: data.project_code ?? null,
    client_code: (data.clients as any)?.code ?? null,
  };
}

export async function listNotificationRecipients(
  supabase: SupabaseClient,
  workspaceDomain: string
): Promise<import("../../../lib/mailer.ts").MailRecipient[]> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("email, first_name, last_name")
    .eq("active", true)
    .ilike("email", `%@${workspaceDomain}`);
  if (error || !data) return [];
  return data.map((u: any) => ({
    email: u.email,
    name: [u.first_name, u.last_name].filter(Boolean).join(" ") || undefined,
  }));
}

export async function getThreadForNotification(
  supabase: SupabaseClient,
  threadId: string
): Promise<{ id: string; title: string; project_id: string } | null> {
  const { data, error } = await supabase
    .from("discussion_threads")
    .select("id, title, project_id")
    .eq("id", threadId)
    .single();
  if (error || !data) return null;
  return data;
}
```

- [x] **Step 2: Commit**

```bash
git add supabase/functions/basecamp-mcp/db.ts
git commit -m "feat: add getProjectForNotification, listNotificationRecipients, getThreadForNotification to db.ts"
```

---

### Task 3: Create `notify.ts`

**Files:**
- Create: `supabase/functions/basecamp-mcp/notify.ts`
- Test: `tests/unit/mcp-notify.test.ts`

- [x] **Step 1: Write the failing tests**

Create `tests/unit/mcp-notify.test.ts`:

```typescript
// tests/unit/mcp-notify.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as db from "../../supabase/functions/basecamp-mcp/db.ts";
import * as mailer from "../../lib/mailer.ts";

// notifyBestEffort is async-fire-and-forget. We need to await the returned promise
// (which is void) and then flush the micro-task queue.
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

const mockSupabase = {} as any;
const agent = { client_id: "agent-1", role: "agent" };

const project = { id: "p-1", name: "Acme Site", project_code: "0001", client_code: "AC" };
const recipients = [{ email: "team@example.com", name: "Team" }];

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.WORKSPACE_DOMAIN = "example.com";
  process.env.APP_URL = "https://pm.example.com";
  vi.spyOn(db, "getProjectForNotification").mockResolvedValue(project);
  vi.spyOn(db, "listNotificationRecipients").mockResolvedValue(recipients);
  vi.spyOn(db, "getProfile").mockResolvedValue({ client_id: "agent-1", name: "HAL 9000" } as any);
  vi.spyOn(db, "getThreadForNotification").mockResolvedValue({ id: "t-1", title: "Kickoff", project_id: "p-1" });
});

describe("notifyBestEffort — event routing", () => {
  it("comment_created calls sendCommentCreatedEmail", async () => {
    const spy = vi.spyOn(mailer, "sendCommentCreatedEmail").mockResolvedValue({ skipped: false, recipientCount: 1 });
    const { notifyBestEffort } = await import("../../supabase/functions/basecamp-mcp/notify.ts");
    notifyBestEffort(mockSupabase, agent, {
      type: "comment_created",
      projectId: "p-1",
      threadId: "t-1",
      threadTitle: "Kickoff",
      commentId: "c-1",
      excerpt: "Hello",
    });
    await flush();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({
      actor: { name: "HAL 9000", email: "" },
      thread: { id: "t-1", title: "Kickoff" },
      comment: { id: "c-1", excerpt: "Hello" },
    });
  });

  it("comment_updated calls sendCommentUpdatedEmail and resolves thread via getThreadForNotification", async () => {
    const spy = vi.spyOn(mailer, "sendCommentUpdatedEmail").mockResolvedValue({ skipped: false, recipientCount: 1 });
    const { notifyBestEffort } = await import("../../supabase/functions/basecamp-mcp/notify.ts");
    notifyBestEffort(mockSupabase, agent, {
      type: "comment_updated",
      threadId: "t-1",
      commentId: "c-1",
      excerpt: "Updated content",
    });
    await flush();
    expect(db.getThreadForNotification).toHaveBeenCalledWith(mockSupabase, "t-1");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({
      thread: { id: "t-1", title: "Kickoff" },
      comment: { id: "c-1", excerpt: "Updated content" },
    });
  });

  it("thread_created calls sendThreadCreatedEmail", async () => {
    const spy = vi.spyOn(mailer, "sendThreadCreatedEmail").mockResolvedValue({ skipped: false, recipientCount: 1 });
    const { notifyBestEffort } = await import("../../supabase/functions/basecamp-mcp/notify.ts");
    notifyBestEffort(mockSupabase, agent, {
      type: "thread_created",
      projectId: "p-1",
      threadId: "t-1",
      threadTitle: "Kickoff",
    });
    await flush();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({
      thread: { id: "t-1", title: "Kickoff" },
    });
  });

  it("thread_updated calls sendThreadUpdatedEmail", async () => {
    const spy = vi.spyOn(mailer, "sendThreadUpdatedEmail").mockResolvedValue({ skipped: false, recipientCount: 1 });
    const { notifyBestEffort } = await import("../../supabase/functions/basecamp-mcp/notify.ts");
    notifyBestEffort(mockSupabase, agent, {
      type: "thread_updated",
      projectId: "p-1",
      threadId: "t-1",
      threadTitle: "Kickoff Updated",
    });
    await flush();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("project_created calls sendProjectCreatedEmail", async () => {
    const spy = vi.spyOn(mailer, "sendProjectCreatedEmail").mockResolvedValue({ skipped: false, recipientCount: 1 });
    const { notifyBestEffort } = await import("../../supabase/functions/basecamp-mcp/notify.ts");
    notifyBestEffort(mockSupabase, agent, { type: "project_created", projectId: "p-1" });
    await flush();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({
      projectUrl: "https://pm.example.com/p-1",
    });
  });

  it("project_updated calls sendProjectUpdatedEmail", async () => {
    const spy = vi.spyOn(mailer, "sendProjectUpdatedEmail").mockResolvedValue({ skipped: false, recipientCount: 1 });
    const { notifyBestEffort } = await import("../../supabase/functions/basecamp-mcp/notify.ts");
    notifyBestEffort(mockSupabase, agent, { type: "project_updated", projectId: "p-1" });
    await flush();
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("notifyBestEffort — edge cases", () => {
  it("skips send and does not throw when recipient list is empty", async () => {
    vi.spyOn(db, "listNotificationRecipients").mockResolvedValue([]);
    const spy = vi.spyOn(mailer, "sendThreadCreatedEmail");
    const { notifyBestEffort } = await import("../../supabase/functions/basecamp-mcp/notify.ts");
    notifyBestEffort(mockSupabase, agent, {
      type: "thread_created",
      projectId: "p-1",
      threadId: "t-1",
      threadTitle: "Empty",
    });
    await flush();
    expect(spy).not.toHaveBeenCalled();
  });

  it("falls back to actor name 'AI' when getProfile returns null", async () => {
    vi.spyOn(db, "getProfile").mockResolvedValue(null);
    const spy = vi.spyOn(mailer, "sendProjectCreatedEmail").mockResolvedValue({ skipped: false, recipientCount: 1 });
    const { notifyBestEffort } = await import("../../supabase/functions/basecamp-mcp/notify.ts");
    notifyBestEffort(mockSupabase, agent, { type: "project_created", projectId: "p-1" });
    await flush();
    expect(spy.mock.calls[0][0].actor.name).toBe("AI");
  });

  it("catches and does not rethrow mailer errors", async () => {
    vi.spyOn(mailer, "sendProjectCreatedEmail").mockRejectedValue(new Error("Mailgun down"));
    const { notifyBestEffort } = await import("../../supabase/functions/basecamp-mcp/notify.ts");
    // Should not throw
    notifyBestEffort(mockSupabase, agent, { type: "project_created", projectId: "p-1" });
    await flush();
    // If we got here without throwing, the test passes
  });
});
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/mcp-notify.test.ts
```

Expected: All tests fail — `notify.ts` does not exist yet.

- [x] **Step 3: Create `supabase/functions/basecamp-mcp/notify.ts`**

```typescript
// supabase/functions/basecamp-mcp/notify.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentIdentity } from "./auth.ts";
import * as db from "./db.ts";
import {
  sendCommentCreatedEmail,
  sendCommentUpdatedEmail,
  sendThreadCreatedEmail,
  sendThreadUpdatedEmail,
  sendProjectCreatedEmail,
  sendProjectUpdatedEmail,
} from "../../../lib/mailer.ts";

export type NotifyEvent =
  | { type: "comment_created"; projectId: string; threadId: string; threadTitle: string; commentId: string; excerpt: string }
  | { type: "comment_updated"; threadId: string; commentId: string; excerpt: string }
  | { type: "thread_created"; projectId: string; threadId: string; threadTitle: string }
  | { type: "thread_updated"; projectId: string; threadId: string; threadTitle: string }
  | { type: "project_created"; projectId: string }
  | { type: "project_updated"; projectId: string };

/**
 * Resolve the projectId for an event. Most events carry it directly;
 * comment_updated must look it up via the thread.
 */
function resolveProjectId(
  supabase: SupabaseClient,
  event: NotifyEvent
): Promise<string | null> {
  if ("projectId" in event) return Promise.resolve(event.projectId);
  // comment_updated: resolve via thread
  return db
    .getThreadForNotification(supabase, event.threadId)
    .then((t) => t?.project_id ?? null);
}

export function notifyBestEffort(
  supabase: SupabaseClient,
  agent: AgentIdentity,
  event: NotifyEvent
): void {
  const appUrl = (typeof Deno !== "undefined" ? Deno.env.get("APP_URL") : process.env.APP_URL) ?? "";
  const workspaceDomain = (typeof Deno !== "undefined" ? Deno.env.get("WORKSPACE_DOMAIN") : process.env.WORKSPACE_DOMAIN) ?? "";

  (async () => {
    try {
      // Fetch recipients, agent profile, project info, and (for comment_updated) thread in parallel
      const projectIdP = resolveProjectId(supabase, event);
      const recipientsP = db.listNotificationRecipients(supabase, workspaceDomain);
      const profileP = db.getProfile(supabase, agent.client_id);
      const threadP =
        event.type === "comment_updated"
          ? db.getThreadForNotification(supabase, event.threadId)
          : Promise.resolve(null);

      const [resolvedProjectId, recipients, profile] = await Promise.all([
        projectIdP,
        recipientsP,
        profileP,
      ]);

      if (recipients.length === 0) {
        console.info("mcp_notification_skipped", { type: event.type, reason: "no_recipients" });
        return;
      }
      if (!resolvedProjectId) return;

      const project = await db.getProjectForNotification(supabase, resolvedProjectId);
      if (!project) return;

      const actor = { name: profile?.name ?? "AI", email: "" };

      switch (event.type) {
        case "comment_created": {
          await sendCommentCreatedEmail({
            recipients,
            actor,
            project,
            thread: { id: event.threadId, title: event.threadTitle },
            threadUrl: `${appUrl}/${resolvedProjectId}/${event.threadId}`,
            comment: { id: event.commentId, excerpt: event.excerpt },
          });
          break;
        }
        case "comment_updated": {
          const thread = await threadP;
          if (!thread) return;
          await sendCommentUpdatedEmail({
            recipients,
            actor,
            project,
            thread: { id: thread.id, title: thread.title },
            threadUrl: `${appUrl}/${resolvedProjectId}/${thread.id}`,
            comment: { id: event.commentId, excerpt: event.excerpt },
          });
          break;
        }
        case "thread_created": {
          await sendThreadCreatedEmail({
            recipients,
            actor,
            project,
            thread: { id: event.threadId, title: event.threadTitle },
            threadUrl: `${appUrl}/${resolvedProjectId}/${event.threadId}`,
          });
          break;
        }
        case "thread_updated": {
          await sendThreadUpdatedEmail({
            recipients,
            actor,
            project,
            thread: { id: event.threadId, title: event.threadTitle },
            threadUrl: `${appUrl}/${resolvedProjectId}/${event.threadId}`,
          });
          break;
        }
        case "project_created": {
          await sendProjectCreatedEmail({
            recipients,
            actor,
            project,
            projectUrl: `${appUrl}/${resolvedProjectId}`,
          });
          break;
        }
        case "project_updated": {
          await sendProjectUpdatedEmail({
            recipients,
            actor,
            project,
            projectUrl: `${appUrl}/${resolvedProjectId}`,
          });
          break;
        }
      }

      console.info("mcp_notification_sent", { type: event.type, recipientCount: recipients.length });
    } catch (e) {
      console.error("mcp_notification_failed", { type: event.type, error: String(e) });
    }
  })();
}
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/mcp-notify.test.ts
```

Expected: All tests pass.

- [x] **Step 5: Commit**

```bash
git add supabase/functions/basecamp-mcp/notify.ts tests/unit/mcp-notify.test.ts
git commit -m "feat: add notifyBestEffort with 6-event routing and edge-case guards"
```

---

### Task 4: Wire notifications into `tools.ts`

**Files:**
- Modify: `supabase/functions/basecamp-mcp/tools.ts`
- Modify: `tests/unit/mcp-write-tools.test.ts`

- [x] **Step 1: Write failing tests**

Add the following to `tests/unit/mcp-write-tools.test.ts`. First update the imports at the top of the file:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";  // add beforeEach
import * as notify from "../../supabase/functions/basecamp-mcp/notify.ts";  // new import
```

Then add these describe blocks after the existing ones:

```typescript
describe("notifications: called on successful writes", () => {
  beforeEach(() => {
    vi.spyOn(notify, "notifyBestEffort").mockImplementation(() => {});
  });

  it("create_project calls notifyBestEffort with project_created", async () => {
    vi.spyOn(db, "createProject").mockResolvedValue({ id: "p-new" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("create_project", { name: "New" });
    expect(notify.notifyBestEffort).toHaveBeenCalledWith(
      expect.anything(),
      agent,
      expect.objectContaining({ type: "project_created", projectId: "p-new" })
    );
  });

  it("update_project calls notifyBestEffort with project_updated", async () => {
    vi.spyOn(db, "updateProject").mockResolvedValue({ id: "p-1" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("update_project", { project_id: "p-1", name: "Updated" });
    expect(notify.notifyBestEffort).toHaveBeenCalledWith(
      expect.anything(),
      agent,
      expect.objectContaining({ type: "project_updated", projectId: "p-1" })
    );
  });

  it("create_thread calls notifyBestEffort with thread_created", async () => {
    vi.spyOn(db, "createThread").mockResolvedValue({ id: "t-new", project_id: "p-1", title: "Hello" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("create_thread", { project_id: "p-1", title: "Hello", body_markdown: "body" });
    expect(notify.notifyBestEffort).toHaveBeenCalledWith(
      expect.anything(),
      agent,
      expect.objectContaining({ type: "thread_created", projectId: "p-1", threadId: "t-new", threadTitle: "Hello" })
    );
  });

  it("update_thread calls notifyBestEffort with thread_updated", async () => {
    vi.spyOn(db, "updateThread").mockResolvedValue({ id: "t-1", project_id: "p-1", title: "Updated Title" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("update_thread", { thread_id: "t-1", title: "Updated Title" });
    expect(notify.notifyBestEffort).toHaveBeenCalledWith(
      expect.anything(),
      agent,
      expect.objectContaining({ type: "thread_updated", projectId: "p-1", threadId: "t-1", threadTitle: "Updated Title" })
    );
  });

  it("create_comment calls notifyBestEffort with comment_created", async () => {
    vi.spyOn(db, "getThread").mockResolvedValue({
      thread: { id: "t-1", project_id: "p-1", title: "Kickoff" },
      comments: [],
      files: [],
    } as any);
    vi.spyOn(db, "createComment").mockResolvedValue({ id: "c-new" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("create_comment", { thread_id: "t-1", body_markdown: "Hi there" });
    expect(notify.notifyBestEffort).toHaveBeenCalledWith(
      expect.anything(),
      agent,
      expect.objectContaining({
        type: "comment_created",
        projectId: "p-1",
        threadId: "t-1",
        threadTitle: "Kickoff",
        commentId: "c-new",
        excerpt: "Hi there",
      })
    );
  });

  it("update_comment calls notifyBestEffort with comment_updated", async () => {
    vi.spyOn(db, "updateComment").mockResolvedValue({ id: "c-1", thread_id: "t-1" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("update_comment", { comment_id: "c-1", body_markdown: "Revised content" });
    expect(notify.notifyBestEffort).toHaveBeenCalledWith(
      expect.anything(),
      agent,
      expect.objectContaining({
        type: "comment_updated",
        threadId: "t-1",
        commentId: "c-1",
        excerpt: "Revised content",
      })
    );
  });
});

describe("notifications: NOT called when DB write returns null", () => {
  beforeEach(() => {
    vi.spyOn(notify, "notifyBestEffort").mockImplementation(() => {});
  });

  it("update_project does not notify when project not found", async () => {
    vi.spyOn(db, "updateProject").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("update_project", { project_id: "bad-id" });
    expect(notify.notifyBestEffort).not.toHaveBeenCalled();
  });

  it("update_thread does not notify when thread not found", async () => {
    vi.spyOn(db, "updateThread").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("update_thread", { thread_id: "bad-id", title: "X" });
    expect(notify.notifyBestEffort).not.toHaveBeenCalled();
  });

  it("update_comment does not notify when comment not found", async () => {
    vi.spyOn(db, "updateComment").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("update_comment", { comment_id: "bad-id", body_markdown: "X" });
    expect(notify.notifyBestEffort).not.toHaveBeenCalled();
  });
});

describe("notifications: tool succeeds even when notifyBestEffort throws", () => {
  beforeEach(() => {
    vi.spyOn(notify, "notifyBestEffort").mockImplementation(() => {
      throw new Error("notification boom");
    });
  });

  it("create_project returns success even when notifyBestEffort throws", async () => {
    vi.spyOn(db, "createProject").mockResolvedValue({ id: "p-1", name: "X" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("create_project", { name: "X" });
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe("p-1");
  });

  it("create_comment returns success even when notifyBestEffort throws", async () => {
    vi.spyOn(db, "getThread").mockResolvedValue({
      thread: { id: "t-1", project_id: "p-1", title: "T" },
      comments: [],
      files: [],
    } as any);
    vi.spyOn(db, "createComment").mockResolvedValue({ id: "c-1" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("create_comment", { thread_id: "t-1", body_markdown: "hi" });
    expect(result.isError).toBeUndefined();
  });
});
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/mcp-write-tools.test.ts
```

Expected: New tests fail because `notifyBestEffort` is not called in `tools.ts` yet.

- [x] **Step 3: Wire `notifyBestEffort` into `tools.ts`**

Add this import at the top of `supabase/functions/basecamp-mcp/tools.ts` (after the existing imports):

```typescript
import { notifyBestEffort } from "./notify.ts";
```

Add a defensive wrapper inside `registerTools` (after the existing `toHtml` helper, before the first `server.tool` call):

```typescript
/** Fire-and-forget — swallows synchronous throws so the tool always returns its result. */
function safeNotify(event: import("./notify.ts").NotifyEvent) {
  try { notifyBestEffort(supabase, agent, event); } catch { /* best-effort */ }
}
```

Then update each write tool handler. The full updated write section (lines ~149–277) becomes:

```typescript
  server.tool(
    "create_project",
    "Create a new project. business_client_id is the UUID of a row in the clients table.",
    {
      name: z.string().min(1),
      description: z.string().nullish(),
      deadline: z.string().date().nullish(),
      business_client_id: z.string().uuid().nullish(),
      tags: z.array(z.string()).nullish(),
      requestor: z.string().nullish(),
      pm_note: z.string().nullish(),
    },
    async (params) => {
      try {
        const result = await db.createProject(supabase, params, agent.client_id);
        safeNotify({ type: "project_created", projectId: result.id });
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "update_project",
    "Update mutable project fields. Only provided fields are changed. status must be one of: new, in_progress, blocked, complete, billing.",
    {
      project_id: z.string().uuid(),
      name: z.string().min(1).nullish(),
      description: z.string().nullish(),
      deadline: z.string().date().nullish(),
      status: z.enum(PROJECT_STATUSES_ZOD).nullish(),
      archived: z.boolean().nullish(),
      tags: z.array(z.string()).nullish(),
      requestor: z.string().nullish(),
      pm_note: z.string().nullish(),
    },
    async ({ project_id, ...params }) => {
      try {
        const result = await db.updateProject(supabase, project_id, params);
        if (!result) return notFound(project_id);
        safeNotify({ type: "project_updated", projectId: result.id });
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "create_thread",
    "Create a discussion thread in a project. body_markdown is converted to HTML automatically.",
    {
      project_id: z.string().uuid(),
      title: z.string().min(1),
      body_markdown: z.string().min(1),
    },
    async ({ project_id, title, body_markdown }) => {
      try {
        const body_html = await toHtml(body_markdown);
        const result = await db.createThread(supabase, { project_id, title, body_markdown, body_html }, agent.client_id);
        safeNotify({
          type: "thread_created",
          projectId: result.project_id,
          threadId: result.id,
          threadTitle: result.title,
        });
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "update_thread",
    "Update a thread's title and/or body. Body markdown is re-converted to HTML.",
    {
      thread_id: z.string().uuid(),
      title: z.string().min(1).optional(),
      body_markdown: z.string().min(1).optional(),
    },
    async ({ thread_id, title, body_markdown }) => {
      try {
        const patch: Record<string, string | undefined> = { title };
        if (body_markdown) {
          patch.body_markdown = body_markdown;
          patch.body_html = await toHtml(body_markdown);
        }
        const result = await db.updateThread(supabase, thread_id, patch);
        if (!result) return notFound(thread_id);
        safeNotify({
          type: "thread_updated",
          projectId: result.project_id,
          threadId: result.id,
          threadTitle: result.title ?? title ?? "",
        });
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "create_comment",
    "Add a comment to a thread. body_markdown is converted to HTML automatically.",
    {
      thread_id: z.string().uuid(),
      body_markdown: z.string().min(1),
    },
    async ({ thread_id, body_markdown }) => {
      try {
        const thread = await db.getThread(supabase, thread_id);
        if (!thread) return notFound(thread_id);
        const body_html = await toHtml(body_markdown);
        const result = await db.createComment(
          supabase,
          { thread_id, body_markdown, body_html, project_id: thread.thread.project_id },
          agent.client_id
        );
        safeNotify({
          type: "comment_created",
          projectId: thread.thread.project_id,
          threadId: thread_id,
          threadTitle: thread.thread.title,
          commentId: result.id,
          excerpt: body_markdown.slice(0, 200),
        });
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "update_comment",
    "Edit a comment's body. Sets edited_at to current timestamp. body_markdown is re-converted to HTML.",
    {
      comment_id: z.string().uuid(),
      body_markdown: z.string().min(1),
    },
    async ({ comment_id, body_markdown }) => {
      try {
        const body_html = await toHtml(body_markdown);
        const result = await db.updateComment(supabase, comment_id, { body_markdown, body_html });
        if (!result) return notFound(comment_id);
        safeNotify({
          type: "comment_updated",
          threadId: result.thread_id,
          commentId: result.id,
          excerpt: body_markdown.slice(0, 200),
        });
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );
```

- [x] **Step 4: Run all MCP tests**

```bash
npx vitest run tests/unit/mcp-write-tools.test.ts tests/unit/mcp-notify.test.ts tests/unit/mailer.test.ts tests/unit/mcp-read-tools.test.ts tests/unit/mcp-auth.test.ts
```

Expected: All pass.

- [x] **Step 5: Commit**

```bash
git add supabase/functions/basecamp-mcp/tools.ts tests/unit/mcp-write-tools.test.ts
git commit -m "feat: wire notifyBestEffort into all 6 MCP write tools"
```

---

## Change Hygiene Notes

- **No schema migrations required.**
- **One new Supabase secret required: `APP_URL`** — must be set in Supabase project secrets before deploying the edge function. Example: `https://pm.yourdomain.com`.
- `lib/mailer.ts` changes are backward-compatible; no existing callers are affected.
- `actor.email` is `""` for agent-originated emails — not rendered in templates, type-safe.
