# Round 7 — Project detail: move Financial Rollup to bottom of page

**Date:** 2026-04-01  
**Status:** Draft (brainstorm Round 7)  
**Type:** UX layout

---

## Problem

On the project detail page (`app/[id]/page.tsx`), the **Financial Rollup** block currently appears **above** Discussions and the files panel. Product preference is to read **activity and files first**, with financial summary **after** those sections.

---

## Goal

Reorder the main `<section className="stackSection">` blocks so **Financial Rollup** renders **below** Discussions and **below** `ProjectFilesPanel` (or immediately above the page footer if other chrome follows).

---

## Non-goals

- No change to rollup calculations, copy, or API contracts.
- No change to responsive/CSS tokens except what is required for natural document flow after reorder.

---

## Requirements

1. **DOM order:** Financial Rollup section follows Discussions and Project Files in the tab/reading order (accessibility: focus order matches visual order).
2. **Visual:** Spacing between sections remains consistent with existing `stackSection` patterns.
3. **Regression:** Hours/expense editors still work; no duplicate mount of heavy client state.

---

## Testing

- Manual: open a project with discussions + files; confirm rollup appears last among primary content blocks.
- Optional: snapshot or Playwright assertion on section heading order if tests exist for this page.

---

## Related

- Current structure: Financial Rollup ~L685; Discussions ~L834; `ProjectFilesPanel` ~L864 in `app/[id]/page.tsx`.
