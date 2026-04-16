# Markdown Content Styles — Design

**Date:** 2026-04-16
**Status:** Design approved, pending implementation plan

## Problem

The MDXEditor composer shows unstyled content while the user is typing: headings, lists, blockquotes, and links render as if CSS reset applied. Rendered display (`.discussionRichText`) has styles for threads and comments, but the class name is coupled to discussions and not reused elsewhere. Project descriptions are stored as markdown-capable text but rendered as plain `<p>` — formatting authored in the editor is lost on display.

The goal is parity between editor and display across all surfaces that author or show markdown, using one shared stylesheet.

## Scope

**In scope**

- Introduce single class `.markdownContent` and apply to: MDXEditor `contentEditableClassName`, thread body display, comment body display, project header description (rendered markdown).
- Render project description as markdown on the project detail header.
- Keep list/board project description previews as plain text (truncated with `line-clamp-2`); introduce `markdownToPlainText` helper for stripping markdown syntax.
- Rename `.discussionRichText` → `.markdownContent` across codebase (CSS + call sites). Delete old class.

**Out of scope**

- DB migration (no `description_html` column; render at display time).
- Toolbar changes to MDXEditor.
- GFM element styling: tables, strikethrough, task list checkboxes.
- Dark mode work beyond keeping existing CSS vars.
- Fixes to email notifications and deadline formatting (tracked as separate adhoc items).

## Architecture

### Shared stylesheet

Port the existing `.discussionRichText` rule block in `app/styles.css` to a new selector `.markdownContent`. Cover the same element set:

- Headings: `h1`–`h6`
- Block: `p`, `ul`, `ol`, `li`, `blockquote`, `pre`, `hr`, `figure`
- Inline: `a`, `code`
- Media: `img`

Keep CSS variables (`--md-editor-*`, etc.) for theming. Delete the `.discussionRichText` block once all call sites migrated.

### Editor parity

`components/markdown-editor.tsx`:

```tsx
<MDXEditor
  contentEditableClassName="markdownContent"
  …
/>
```

The heading/list/quote plugins already produce real DOM elements (`<h1>`, `<ul>`, `<blockquote>`). Applying `.markdownContent` to the contentEditable container gives the composer the same visual treatment as the display surfaces. No toolbar change; markdown shortcuts continue to produce styled output.

### Display surfaces

Replace `className="discussionRichText"` with `className="markdownContent"` at the two existing call sites:

- `app/[id]/[discussion]/page.tsx:350` — thread body
- `app/[id]/[discussion]/page.tsx:416` — comment body

No pipeline change; `body_html` pre-rendered by `marked` continues to be injected. The existing raw-HTML injection pattern is preserved — behavior is unchanged.

### Project description — render pipeline

**Project detail header** (`app/[id]/page.tsx:540`): render the description as markdown at display time in the server component.

- Call `lib/markdown.ts::renderMarkdown(description)` (existing helper; already wraps `marked.parse` with `gfm: true`, `breaks: true`).
- Emit the rendered HTML inside a `<div className="markdownContent">` wrapper in place of the current `<p className="headerSubtitle">{projectDescription}</p>`.
- No new DB column; no migration. Rendering cost is negligible and Next.js server rendering handles it per request.

**List/board previews** (`components/projects/projects-list-view.tsx:170`, `components/projects/projects-board-view.tsx:160`): keep the existing `<p>` + `line-clamp-2` pattern, but feed it plain text stripped of markdown syntax.

- New helper `lib/markdown.ts::markdownToPlainText(md: string): string`
  - Strip markdown syntax: heading hashes, bold/italic markers, link syntax, code fences, blockquote prefixes, list bullets.
  - Collapse whitespace.
  - Return single-line-friendly text suitable for truncation.
- Implementation: use `marked` to render to HTML, then strip tags and decode entities, OR use a small regex pipeline. Pick the simpler of the two at implementation time.

### Security — HTML injection

Markdown rendered to HTML is injected as raw HTML at three surfaces (two existing, one new).

- **Thread / comment bodies** — `body_html` is generated via `marked` in `supabase/functions/basecamp-mcp/tools.ts::toHtml` at write time and stored in the DB without sanitization. This is the status quo and is not changed by this work.
- **Project description (new)** — renders via `lib/markdown.ts::renderMarkdown`, which already runs output through `sanitize-html` with an allowlist of tags, attributes, and schemes. The new path is sanitized by default.

Trust boundary: authenticated team members. If tightening the thread/comment path is desired later, route that HTML through `renderMarkdown` (or an equivalent sanitizer) at display time. Out of scope here; recorded for follow-up.

### File-level changes (summary)

- `app/styles.css` — add `.markdownContent` block (port from `.discussionRichText`), remove old block.
- `components/markdown-editor.tsx` — `contentEditableClassName="markdownContent"`.
- `app/[id]/[discussion]/page.tsx` — replace class name at two sites.
- `app/[id]/page.tsx` — render project description as markdown via `renderMarkdown`; apply `.markdownContent` wrapper.
- `components/projects/projects-list-view.tsx` — feed `projectDescription` through `markdownToPlainText`.
- `components/projects/projects-board-view.tsx` — same as list view.
- `lib/markdown.ts` — add `markdownToPlainText`. `renderMarkdown` already exists.

## Data Flow

```
Author in MDXEditor → markdown string → DB (projects.description, threads.body, comments.body)

Display (project header):    DB.description → renderMarkdown() → HTML → <div.markdownContent>
Display (thread/comment):    DB.body_html                   → HTML → <div.markdownContent>
Display (list/board card):   DB.description → markdownToPlainText() → <p.projectDescription.line-clamp-2>
Editor (all surfaces):       MDXEditor contentEditable with class .markdownContent
```

## Error Handling

- `renderMarkdown(null | "")` returns empty string → render nothing (guarded by existing `projectDescription ? … : null`).
- `markdownToPlainText(null | "")` returns empty string → existing `|| "No description provided."` fallback stays intact.
- Invalid markdown does not throw; `marked` is lenient. No new error paths.

## Testing

- Unit: `markdownToPlainText` — headings, lists, bold/italic, links, code fences, blockquote all reduced to plain text with collapsed whitespace; empty input returns empty.
- Unit: `renderMarkdown` — existing coverage stands.
- Visual / manual: open a project with a description containing h1, list, link, code, blockquote. Verify header renders styled; list and board cards show plain-text preview; editor composer shows the same visual treatment as the display.
- Regression: thread and comment rendering unchanged.
- Regression: codemod leaves no stale `.discussionRichText` references (grep the repo).

## Migration Notes

- Pure class rename + pipeline addition. No DB migration.
- Two display-site class renames, one editor prop change, one stylesheet rename, two list/board helper calls, one header render change.
- No feature flag needed; change is additive/visual.

## Open Questions

None at spec time.
