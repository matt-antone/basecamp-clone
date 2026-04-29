# PR 1: `lib/mailer.ts` Dedupe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared HTML/text email content builders in `lib/mailer.ts` so the 6 `send*Email` functions stop duplicating ~60 lines of subject/text/html assembly. After this PR, `fallow dupes` reports zero clone groups inside `lib/mailer.ts`.

**Architecture:** Two builders. `buildThreadEmailContent(args, opts)` covers the 4 thread/comment functions (created/updated × thread/comment). `buildProjectEmailContent(args, opts)` covers the 2 project functions (created/updated). Each `send*Email` becomes a thin wrapper that supplies `actionDescription`, `subjectPrefix`, and `bodyMarkdown`. `sendMail` is unchanged.

**Tech Stack:** TypeScript, Vitest, `marked`, Mailgun.

**Refactor discipline:** Existing tests (`tests/unit/mailer.test.ts`) cover all 6 functions and assert the rendered subject + body content. They are the safety net — they must stay green throughout. No new tests are added; the failing-test-first TDD pattern doesn't apply because the behavior isn't changing.

---

### Task 1: Refactor `lib/mailer.ts` to use shared content builders

**Files:**
- Modify: `lib/mailer.ts`

**Reference — current duplicated structure (read once before starting):** Each of `sendThreadCreatedEmail`, `sendCommentCreatedEmail`, `sendCommentUpdatedEmail`, `sendThreadUpdatedEmail` follows the same shape: build label → build subject → escape four fields → render markdown body → call `sendMail` with the same text/html templates. Only the `actionDescription` ("started a new discussion" vs "commented on a discussion" vs "updated a comment" vs "updated a discussion"), the `subjectPrefix` ("New discussion" vs "New comment on" vs "Comment updated on" vs "Discussion updated"), and the body source (`thread.bodyMarkdown` vs `comment.bodyMarkdown`) differ. `sendProjectCreatedEmail` and `sendProjectUpdatedEmail` follow a similar but separate shape (no thread, project link instead of thread link, "created a new project" vs "updated project").

- [ ] **Step 1: Create branch from `main`**

```bash
git checkout main
git pull
git checkout -b refactor/mailer-dedupe
```

- [ ] **Step 2: Verify baseline is green**

Run: `pnpm test tests/unit/mailer.test.ts`
Expected: 8 tests pass (skips/passes only, no failures).

Run: `pnpm exec tsc --noEmit`
Expected: no output (exit 0).

Run: `pnpm exec fallow dupes 2>&1 | grep -A 2 "lib/mailer.ts"`
Expected: at least one clone group includes `lib/mailer.ts:138-196` and `lib/mailer.ts:228-280` (the dupe we are removing).

- [ ] **Step 3: Add the two content builders above the send functions**

In `lib/mailer.ts`, insert these two helpers immediately after the existing `buildMailgunAuthorization` function (around line 80, before `resetMailerForTests`). Do not modify any other code yet.

```ts
type ThreadEmailContentOpts = {
  subjectPrefix: string;
  actionDescription: string;
  bodyMarkdown: string;
};

function buildThreadEmailContent(args: ThreadEmailArgs, opts: ThreadEmailContentOpts) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] ${opts.subjectPrefix}: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedThreadUrl = escapeHtml(args.threadUrl);
  const bodyHtml = markdownToEmailHtml(opts.bodyMarkdown);

  const text = [
    `${args.actor.name} ${opts.actionDescription} in ${args.project.name}.`,
    "",
    `Thread: ${args.thread.title}`,
    opts.bodyMarkdown,
    `Open: ${args.threadUrl}`
  ].join("\n");

  const html = [
    "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
    `<p><strong>${escapedActorName}</strong> ${opts.actionDescription} in <strong>${escapedProjectName}</strong>.</p>`,
    `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
    bodyHtml,
    `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
    "</div>"
  ].join("");

  return { subject, text, html };
}

type ProjectEmailContentOpts = {
  subjectPrefix: string;
  actionDescription: string;
};

function buildProjectEmailContent(args: ProjectEmailArgs, opts: ProjectEmailContentOpts) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] ${opts.subjectPrefix}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedProjectUrl = escapeHtml(args.projectUrl);

  const text = [
    `${args.actor.name} ${opts.actionDescription}: ${args.project.name}.`,
    "",
    `Open: ${args.projectUrl}`
  ].join("\n");

  const html = [
    "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
    `<p><strong>${escapedActorName}</strong> ${opts.actionDescription}: <strong>${escapedProjectName}</strong>.</p>`,
    `<p><a href="${escapedProjectUrl}">Open project</a></p>`,
    "</div>"
  ].join("");

  return { subject, text, html };
}
```

- [ ] **Step 4: Replace the four thread/comment send functions**

Replace the bodies of `sendThreadCreatedEmail`, `sendCommentCreatedEmail`, `sendCommentUpdatedEmail`, and `sendThreadUpdatedEmail` (currently lines 138–256) with thin wrappers. The whole block from `export async function sendThreadCreatedEmail` through the closing `}` of `sendThreadUpdatedEmail` becomes:

```ts
export async function sendThreadCreatedEmail(args: ThreadEmailArgs) {
  const { subject, text, html } = buildThreadEmailContent(args, {
    subjectPrefix: "New discussion",
    actionDescription: "started a new discussion",
    bodyMarkdown: args.thread.bodyMarkdown
  });
  return sendMail({ recipients: args.recipients, subject, text, html });
}

export async function sendCommentCreatedEmail(args: CommentEmailArgs) {
  const { subject, text, html } = buildThreadEmailContent(args, {
    subjectPrefix: "New comment on",
    actionDescription: "commented on a discussion",
    bodyMarkdown: args.comment.bodyMarkdown
  });
  return sendMail({ recipients: args.recipients, subject, text, html });
}

export async function sendCommentUpdatedEmail(args: CommentEmailArgs) {
  const { subject, text, html } = buildThreadEmailContent(args, {
    subjectPrefix: "Comment updated on",
    actionDescription: "updated a comment",
    bodyMarkdown: args.comment.bodyMarkdown
  });
  return sendMail({ recipients: args.recipients, subject, text, html });
}

export async function sendThreadUpdatedEmail(args: ThreadEmailArgs) {
  const { subject, text, html } = buildThreadEmailContent(args, {
    subjectPrefix: "Discussion updated",
    actionDescription: "updated a discussion",
    bodyMarkdown: args.thread.bodyMarkdown
  });
  return sendMail({ recipients: args.recipients, subject, text, html });
}
```

- [ ] **Step 5: Run mailer tests after thread/comment refactor**

Run: `pnpm test tests/unit/mailer.test.ts`
Expected: all tests still pass.

If any fail, the most likely causes:
- Subject string mismatch (check the `subjectPrefix` you passed against the test expectation, e.g. `[AC-0001-Acme Site] Comment updated on: Design Review` requires `subjectPrefix: "Comment updated on"`)
- HTML/text template mismatch (compare the original block against `buildThreadEmailContent` line-by-line — whitespace and template literals must match exactly)

- [ ] **Step 6: Replace the two project send functions**

Replace the bodies of `sendProjectCreatedEmail` and `sendProjectUpdatedEmail` (currently lines 258–304) with:

```ts
export async function sendProjectCreatedEmail(args: ProjectEmailArgs) {
  const { subject, text, html } = buildProjectEmailContent(args, {
    subjectPrefix: "New project created",
    actionDescription: "created a new project"
  });
  return sendMail({ recipients: args.recipients, subject, text, html });
}

export async function sendProjectUpdatedEmail(args: ProjectEmailArgs) {
  const { subject, text, html } = buildProjectEmailContent(args, {
    subjectPrefix: `Project updated: ${args.project.name}`,
    actionDescription: "updated project"
  });
  return sendMail({ recipients: args.recipients, subject, text, html });
}
```

Note: `sendProjectUpdatedEmail`'s subject embeds `args.project.name` in the prefix because the original was `[label] Project updated: NAME` (vs. plain `New project created` for the create case). This keeps the existing test assertion `expect(body.get("subject")).toBe("[AC-0001-Acme Site] Project updated: Acme Site")` passing.

- [ ] **Step 7: Run full mailer tests**

Run: `pnpm test tests/unit/mailer.test.ts`
Expected: all 8 tests pass.

- [ ] **Step 8: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 9: Run full test suite**

Run: `pnpm test`
Expected: 447 passed, 3 skipped (matches pre-refactor baseline). No regressions in `thread-route.test.ts` or `thread-comment-route.test.ts`, which mock the mailer functions.

- [ ] **Step 10: Run `fallow dead-code`**

Run: `pnpm exec fallow dead-code`
Expected: `✓ No issues found`. The new helpers are used, no new dead code introduced.

- [ ] **Step 11: Run `fallow dupes` and verify mailer dupes are gone**

Run: `pnpm exec fallow dupes 2>&1 | grep "lib/mailer.ts" || echo "no mailer dupes"`
Expected: `no mailer dupes`. The previously-flagged group `lib/mailer.ts:138-196 ↔ lib/mailer.ts:228-280` no longer appears.

If a smaller mailer dupe still appears (e.g., the four thin wrappers triggering a new shorter clone group), check whether `fallow dupes` is configured with a `minLines` threshold that would catch them. If the wrappers themselves cluster as a dupe, that's expected and acceptable for this PR — they are 6 lines each and below the default 5-line floor only if structurally distinct. Document any remaining mailer dupe in the PR description and accept it; do not add a fallow ignore.

- [ ] **Step 12: Commit**

```bash
git add lib/mailer.ts
git commit -m "$(cat <<'EOF'
refactor(mailer): extract shared email content builders

Eliminate ~60-line dupe across the 6 send*Email functions by
extracting buildThreadEmailContent and buildProjectEmailContent.
Each send wrapper now supplies subjectPrefix, actionDescription,
and (for thread/comment) bodyMarkdown.

No behavior change. Existing mailer tests remain the safety net.
EOF
)"
```

- [ ] **Step 13: Push and open PR**

```bash
git push -u origin refactor/mailer-dedupe
gh pr create --title "refactor(mailer): extract shared email content builders" --body "$(cat <<'EOF'
## Summary
- Extract `buildThreadEmailContent` (covers 4 thread/comment send funcs)
- Extract `buildProjectEmailContent` (covers 2 project send funcs)
- No behavior change

## Why
First PR in the fallow dupes cleanup series (see `docs/superpowers/specs/2026-04-29-fallow-dupes-cleanup-design.md`). Removes the largest internal dupe in `lib/mailer.ts` (~60 lines, originally flagged at 138-196 ↔ 228-280).

## Test plan
- [x] `pnpm test tests/unit/mailer.test.ts` — all 8 mailer tests pass
- [x] `pnpm test` — 447 pass / 3 skipped (matches main baseline)
- [x] `pnpm exec tsc --noEmit` — clean
- [x] `pnpm exec fallow dead-code` — clean
- [x] `pnpm exec fallow dupes` — no `lib/mailer.ts` clone groups remain
EOF
)"
```

---

## Self-Review

- **Spec coverage:** This plan implements PR 1 of `docs/superpowers/specs/2026-04-29-fallow-dupes-cleanup-design.md`. PRs 2–9 will each get their own plan after the previous one lands (per the bottom-up sequencing in the spec).
- **Placeholders:** none.
- **Type consistency:** `ThreadEmailArgs`, `CommentEmailArgs`, `ProjectEmailArgs`, and the two `*ContentOpts` types are referenced consistently. `buildThreadEmailContent` accepts `ThreadEmailArgs` and works for both `ThreadEmailArgs` and `CommentEmailArgs` callers because `CommentEmailArgs extends ThreadEmailArgs`.
- **Scope:** single file, single PR, single fallow dupe cleared.
