# Markdown Content Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a single shared `.markdownContent` stylesheet applied to the MDXEditor composer and every markdown display surface (threads, comments, project header), rendering project descriptions as markdown on the header and as stripped plain text on list/board previews.

**Architecture:** Rename existing `.discussionRichText` CSS rule block to `.markdownContent` and reuse it across editor + display. Add `markdownToPlainText` helper to `lib/markdown.ts` for list/board previews. The project header renders `description` through the existing sanitized `renderMarkdown` pipeline (which already runs output through `sanitize-html` with an allowlist) and injects the resulting HTML into a `.markdownContent` wrapper using the same `dangerouslySetInnerHTML` pattern already used for thread and comment bodies. No DB migration, no schema changes, no new packages.

**Tech Stack:** Next.js App Router (Next 15), React 19, `marked` 13, `sanitize-html` 2, `@mdxeditor/editor` 3, vitest 2.

**Note on client vs server:** `app/[id]/page.tsx` is a `"use client"` component. `renderMarkdown` and `markdownToPlainText` both run safely in the browser (`marked` + `sanitize-html` are isomorphic). No server/client boundary changes required.

**Security note:** HTML injection at the project header is safe because `renderMarkdown` sanitizes its output with `sanitize-html` using an allowlist of tags, attributes, and URL schemes. This is the same pipeline already used in the codebase. The thread and comment bodies continue to use pre-rendered `body_html` from the MCP edge function; that pipeline is the existing status quo and is explicitly out of scope per the spec.

---

## File Structure

Files created or modified by this plan:

- `lib/markdown.ts` — **modify**: add `markdownToPlainText(md)` next to existing `renderMarkdown`.
- `tests/unit/markdown.test.ts` — **modify**: add `markdownToPlainText` coverage next to the existing `renderMarkdown` test.
- `app/styles.css` — **modify**: rename the `.discussionRichText` rule block to `.markdownContent` (lines 2968–3045).
- `components/markdown-editor.tsx` — **modify**: set `contentEditableClassName="markdownContent"` (line 36).
- `app/[id]/[discussion]/page.tsx` — **modify**: replace `className="discussionRichText"` at line 350 (thread body) and line 416 (comment body).
- `app/[id]/page.tsx` — **modify**: replace the plain-text `<p className="headerSubtitle">{projectDescription}</p>` at line 540 with a `.markdownContent` block fed by `renderMarkdown`.
- `components/projects/projects-list-view.tsx` — **modify**: wrap `project.description` at line 170 with `markdownToPlainText(...)`.
- `components/projects/projects-board-view.tsx` — **modify**: wrap `project.description` at line 161 with `markdownToPlainText(...)`.

Each file has one clear responsibility and follows existing conventions. No new files are introduced.

---

### Task 1: Add `markdownToPlainText` helper with tests

**Files:**
- Modify: `lib/markdown.ts`
- Test: `tests/unit/markdown.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these cases to `tests/unit/markdown.test.ts` (keep existing `renderMarkdown` test intact):

```ts
import { describe, expect, it } from "vitest";
import { markdownToPlainText, renderMarkdown } from "@/lib/markdown";

describe("markdown renderer", () => {
  it("renders markdown and removes script tags", () => {
    const html = renderMarkdown("# Hello\n<script>alert('x')</script>");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).not.toContain("<script>");
  });
});

describe("markdownToPlainText", () => {
  it("returns empty string for empty input", () => {
    expect(markdownToPlainText("")).toBe("");
    expect(markdownToPlainText(null as unknown as string)).toBe("");
    expect(markdownToPlainText(undefined as unknown as string)).toBe("");
  });

  it("strips heading hashes", () => {
    expect(markdownToPlainText("# Title\n## Sub")).toBe("Title Sub");
  });

  it("strips bold, italic, and inline code markers", () => {
    expect(markdownToPlainText("**bold** and *italic* and `code`")).toBe("bold and italic and code");
  });

  it("reduces links to their text", () => {
    expect(markdownToPlainText("See [the docs](https://example.com) now")).toBe("See the docs now");
  });

  it("strips list bullets and numbering", () => {
    expect(markdownToPlainText("- one\n- two\n1. three")).toBe("one two three");
  });

  it("strips blockquote prefixes", () => {
    expect(markdownToPlainText("> quoted line")).toBe("quoted line");
  });

  it("strips fenced code blocks", () => {
    expect(markdownToPlainText("intro\n```\nconst x = 1;\n```\nend")).toBe("intro const x = 1; end");
  });

  it("collapses whitespace to single spaces", () => {
    expect(markdownToPlainText("one\n\n\ntwo   three")).toBe("one two three");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/markdown.test.ts`
Expected: the `markdownToPlainText` cases FAIL with an import error (`markdownToPlainText is not exported`) or `is not a function`. Existing `renderMarkdown` test still passes.

- [ ] **Step 3: Implement `markdownToPlainText`**

Replace the contents of `lib/markdown.ts` with:

```ts
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(input: string) {
  const html = marked.parse(input, { async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "span"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title"]
    },
    allowedSchemes: ["http", "https", "mailto"]
  });
}

export function markdownToPlainText(input: string | null | undefined): string {
  if (!input) return "";
  const html = marked.parse(input, { async: false }) as string;
  const stripped = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {}
  });
  return stripped.replace(/\s+/g, " ").trim();
}
```

Rationale: reusing `marked` + `sanitizeHtml` with an empty allowlist is simpler and safer than hand-rolled regex, handles every markdown construct `marked` knows about, and decodes entities on the way out.

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/markdown.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add lib/markdown.ts tests/unit/markdown.test.ts
git commit -m "feat(markdown): add markdownToPlainText helper for preview stripping"
```

---

### Task 2: Rename `.discussionRichText` → `.markdownContent` in stylesheet

**Files:**
- Modify: `app/styles.css:2968-3045`

- [ ] **Step 1: Replace the rule block**

In `app/styles.css`, replace every `.discussionRichText` occurrence in the block spanning lines 2968–3045 with `.markdownContent`. The selectors, declarations, whitespace, and CSS variable references stay identical — only the class name changes.

Before (lines 2968–3045):

```css
.discussionRichText {
  color: var(--text-primary);
}

.discussionRichText :where(h1, h2, h3, h4, h5, h6) {
  margin: 1.25rem 0 0.6rem;
  font-family: var(--font-display), Georgia, serif;
  line-height: 1.08;
  letter-spacing: -0.02em;
}

.discussionRichText :where(p, ul, ol, blockquote, pre, hr, figure) {
  margin: 0 0 0.95rem;
}

.discussionRichText :where(ul, ol) {
  display: block;
  padding-left: 1.25rem;
}

.discussionRichText ul {
  list-style: disc;
}

.discussionRichText ol {
  list-style: decimal;
}

.discussionRichText li {
  display: list-item;
  margin: 0.32rem 0;
}

.discussionRichText li::marker {
  color: var(--projects-accent-strong);
}

.discussionRichText a {
  color: var(--link-color);
  text-decoration: underline;
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.16em;
}

.discussionRichText blockquote {
  padding: 0.1rem 0 0.1rem 0.95rem;
  border-left: 2px solid color-mix(in srgb, var(--active-border) 45%, transparent);
  color: var(--text-muted);
}

.discussionRichText :where(code, pre) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

.discussionRichText code {
  padding: 0.12rem 0.3rem;
  background: color-mix(in srgb, var(--panel-bg) 68%, var(--input-bg));
  font-size: 0.92em;
}

.discussionRichText pre {
  overflow-x: auto;
  padding: 0.8rem 0.9rem;
  border: 1px solid color-mix(in srgb, var(--thread-border) 76%, transparent);
  background: color-mix(in srgb, var(--panel-bg) 74%, var(--input-bg));
}

.discussionRichText pre code {
  padding: 0;
  background: transparent;
}

.discussionRichText img {
  display: block;
  max-width: min(100%, 42rem);
  height: auto;
  border: 1px solid color-mix(in srgb, var(--thread-border) 76%, transparent);
}
```

After: identical block with `.discussionRichText` → `.markdownContent` on every line. Use the `Edit` tool with `replace_all: true` scoped to this block, or perform 16 discrete replacements (one per selector).

Concrete approach: run an `Edit` on `app/styles.css` with `old_string` being the `.discussionRichText` block above verbatim and `new_string` being the same block with each `.discussionRichText` replaced by `.markdownContent`.

- [ ] **Step 2: Verify no stale `.discussionRichText` CSS remains**

Run (via the Grep tool): search `discussionRichText` in `app/styles.css`.
Expected: zero matches.

- [ ] **Step 3: Verify display still works visually (unchanged sites)**

The two call sites in `app/[id]/[discussion]/page.tsx` still reference `.discussionRichText` at this point, so threads and comments will render **unstyled** after this commit until Task 4. This is intentional — keep the commits small. Do not regress-test threads yet; the next tasks restore styling.

- [ ] **Step 4: Commit**

```bash
git add app/styles.css
git commit -m "refactor(css): rename discussionRichText to markdownContent"
```

---

### Task 3: Apply `.markdownContent` to MDXEditor composer

**Files:**
- Modify: `components/markdown-editor.tsx:36`

- [ ] **Step 1: Change the contentEditable class**

In `components/markdown-editor.tsx`, change line 36:

```tsx
      contentEditableClassName="commentMdxContent"
```

to:

```tsx
      contentEditableClassName="markdownContent"
```

Leave everything else (plugins, toolbar, outer `className="commentMdxEditor"`) untouched.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (Run full project typecheck, not just this file, since types may be widened.)

- [ ] **Step 3: Commit**

```bash
git add components/markdown-editor.tsx
git commit -m "feat(editor): apply shared markdownContent class to MDXEditor"
```

---

### Task 4: Update thread + comment display sites

**Files:**
- Modify: `app/[id]/[discussion]/page.tsx:350`
- Modify: `app/[id]/[discussion]/page.tsx:416`

- [ ] **Step 1: Rename thread body class**

At line 350, change the class name on the thread body `<div>` from `discussionRichText` to `markdownContent`. The raw-HTML injection (using the existing `body_html` prop) is unchanged — same trust boundary, same pipeline.

Result line (full):

```tsx
<div className="markdownContent" dangerouslySetInnerHTML={{ __html: thread.body_html }} />
```

- [ ] **Step 2: Rename comment body class**

At line 416, change the class name on the comment body `<div>` from `discussionRichText` to `markdownContent`. Same note as Step 1 — only the class string changes.

Result line (full):

```tsx
<div className="markdownContent" dangerouslySetInnerHTML={{ __html: comment.body_html }} />
```

- [ ] **Step 3: Verify no stale references in this file**

Grep `discussionRichText` in `app/[id]/[discussion]/page.tsx`.
Expected: zero matches.

- [ ] **Step 4: Run existing discussion tests**

Run: `npx vitest run tests/unit/thread-route.test.ts tests/unit/thread-comment-route.test.ts tests/unit/comment-edit-route.test.ts tests/unit/discussion-composer.test.tsx tests/unit/create-discussion-dialog.test.tsx`
Expected: all pass. Class-name rename is a display-only change; route/composer tests should be unaffected.

- [ ] **Step 5: Commit**

```bash
git add "app/[id]/[discussion]/page.tsx"
git commit -m "refactor(discussions): use markdownContent for thread and comment bodies"
```

---

### Task 5: Render project description as markdown on header

**Files:**
- Modify: `app/[id]/page.tsx:540`

- [ ] **Step 1: Import `renderMarkdown`**

Near the other `lib/` imports at the top of `app/[id]/page.tsx` (around lines 11–15), add:

```tsx
import { renderMarkdown } from "@/lib/markdown";
```

Keep the existing imports — insert alphabetically, e.g. between `import { calculateProjectExpensesTotalUsd, ... } from "@/lib/project-financials"` and `import { createProjectDialogValues, ... } from "@/lib/project-utils"`.

- [ ] **Step 2: Replace the plain `<p>` with a sanitized markdown block**

At line 540, replace the single-line `<p className="headerSubtitle">{projectDescription}</p>` with a `<div>` that carries both classes (`markdownContent` for element styling, `headerSubtitle` for the existing vertical rhythm) and renders sanitized HTML from `renderMarkdown(projectDescription)`.

Rationale: `.headerSubtitle` already tunes margins/spacing for the header; `.markdownContent` adds element styling for `h1`/`ul`/`blockquote` etc. `renderMarkdown` runs through `sanitize-html` with an allowlist, so the injected HTML is sanitized at the render boundary — this is the safe pattern already used elsewhere in the codebase for thread and comment bodies.

New JSX (full):

```tsx
{projectDescription ? (
  <div
    className="markdownContent headerSubtitle"
    dangerouslySetInnerHTML={{ __html: renderMarkdown(projectDescription) }}
  />
) : null}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Run project-detail tests**

Run: `npx vitest run tests/unit/project-detail-route.test.ts`
Expected: pass. This test covers the route, not the JSX; a rendering change here should not break it.

- [ ] **Step 5: Commit**

```bash
git add "app/[id]/page.tsx"
git commit -m "feat(projects): render project description as markdown on header"
```

---

### Task 6: Strip markdown in list + board previews

**Files:**
- Modify: `components/projects/projects-list-view.tsx:170`
- Modify: `components/projects/projects-board-view.tsx:161`

- [ ] **Step 1: Import `markdownToPlainText` in list view**

Open `components/projects/projects-list-view.tsx` and add to the import block for `lib/markdown`:

```tsx
import { markdownToPlainText } from "@/lib/markdown";
```

If no `@/lib/markdown` import currently exists, add it alongside the other `@/lib/*` imports. If it does exist, extend its named imports.

- [ ] **Step 2: Feed the description through the helper**

At line 170, change:

```tsx
<p className="projectDescription">{project.description?.trim() || "No description provided."}</p>
```

to:

```tsx
<p className="projectDescription">{markdownToPlainText(project.description).trim() || "No description provided."}</p>
```

- [ ] **Step 3: Repeat for board view**

Open `components/projects/projects-board-view.tsx` and add:

```tsx
import { markdownToPlainText } from "@/lib/markdown";
```

At line 161, change:

```tsx
<p className="projectDescription projectFlowCardDescription line-clamp-2">
  {project.description?.trim() || "No description provided."}
</p>
```

to:

```tsx
<p className="projectDescription projectFlowCardDescription line-clamp-2">
  {markdownToPlainText(project.description).trim() || "No description provided."}
</p>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Run list + board view tests**

Run: `npx vitest run tests/unit/projects-list-view.test.tsx tests/unit/projects-board-view.test.tsx`
Expected: all pass. If the tests assert exact-description text (e.g. `"# Heading"`), update the asserted string to the stripped plain-text form (`"Heading"`) — but only if the test is the thing that breaks; do not proactively alter unrelated assertions.

- [ ] **Step 6: Commit**

```bash
git add components/projects/projects-list-view.tsx components/projects/projects-board-view.tsx
git commit -m "feat(projects): strip markdown in list and board description previews"
```

---

### Task 7: Regression sweep + full verification

**Files:** none modified. Verification only.

- [ ] **Step 1: Repo-wide `discussionRichText` grep**

Use the Grep tool to search `discussionRichText` across the whole repo (no path filter).
Expected: zero matches. If any turn up (e.g. in markdown docs or seeds), evaluate: CSS/TSX hits are bugs to fix; doc references to the rename history can stay.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean. `next lint` should not complain about the new header markup in `app/[id]/page.tsx` since the same raw-HTML injection pattern is already used at the thread and comment sites.

- [ ] **Step 3: Full unit test run**

Run: `npm test`
Expected: full suite passes.

- [ ] **Step 4: Manual visual check**

Start the dev server: `npm run dev`, then open a project whose description contains at least an `h1`, a bullet list, a link, inline `code`, and a blockquote. Verify, in order:

1. Project header renders the description as formatted markdown (heading, list bullets, styled link, code span, blockquote bar).
2. Go to `/projects` (list view) and `/projects` board view — the same project shows a **plain-text** two-line-clamped preview with no markdown syntax characters visible.
3. Open any discussion thread — thread body and comment bodies render with identical typography to the editor.
4. Start a new comment/discussion — the MDXEditor contentEditable shows the same heading/list/blockquote styling while typing.

If any surface looks unstyled or shows raw markdown syntax, diagnose before proceeding. The most likely cause is a missed class-rename.

- [ ] **Step 5: Final commit (if any cleanup happened in step 4)**

If the manual check revealed a stray reference or missing class, fix and commit with a descriptive message. Otherwise, no commit is needed for this task.

---

## Notes for the implementer

- The existing `.commentMdxEditor` wrapper class on `MDXEditor` is preserved; only the inner `contentEditableClassName` changes. If any styling in `app/styles.css` targets `.commentMdxContent` descendants, that rule becomes dead code — grep and remove only if found, but do not introduce speculative cleanup.
- `sanitize-html` with `allowedTags: []` decodes entities and removes all tags, which is the desired behavior for `markdownToPlainText`. Do not substitute a hand-rolled regex to "simplify" — the entity decoding and nested-markup safety are the reason we chose this path.
- The thread/comment pipeline still injects `body_html` generated by the MCP edge function without additional sanitization at render. That is the status quo trust boundary (authenticated team members only) and is explicitly out of scope per the spec. Do not add sanitization here in this plan.
