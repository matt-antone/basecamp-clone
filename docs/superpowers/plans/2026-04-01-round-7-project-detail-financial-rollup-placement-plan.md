# Round 7 — Financial Rollup placement — implementation plan

**Status:** Done  
**Closed:** 2026-04-01 — Financial Rollup moved below Discussions and `ProjectFilesPanel` in `app/[id]/page.tsx`; `npm run test` passed.
**Spec:** [2026-04-01-round-7-project-detail-financial-rollup-placement-design.md](../specs/2026-04-01-round-7-project-detail-financial-rollup-placement-design.md)

---

## Goal

Move the **Financial Rollup** `<section>` to the bottom of the project detail page content, after Discussions and Project Files.

---

## Files

| Action | File |
|--------|------|
| Modify | `app/[id]/page.tsx` — cut/paste the Financial Rollup block after Discussions + `ProjectFilesPanel` |

---

## Tasks

- [x] **Step 1:** In `app/[id]/page.tsx`, locate the Financial Rollup `stackSection` (starts at “Financial Rollup” `<h2>`).
- [x] **Step 2:** Move the entire section (including inner state usage — ensure no hooks order violation: if any hooks were interleaved, keep hook calls at top of component; only move JSX).
- [x] **Step 3:** Verify React hooks rules: **do not** place hooks inside the moved block if they were not there before; only JSX moves.
- [x] **Step 4:** Smoke test: load project, expand discussions, upload area still works, rollup still shows correct numbers.
- [x] **Step 5:** Run targeted tests if any cover `page.tsx` or run `npm run test` if the file is broadly covered.

---

## Notes

If the page uses conditional rendering that depends on section order for refs or `useEffect` dependencies, adjust those dependencies after move.
