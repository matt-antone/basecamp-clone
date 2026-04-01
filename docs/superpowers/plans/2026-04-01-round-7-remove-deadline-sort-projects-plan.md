# Round 7 — Remove deadline sort — implementation plan

**Status:** Complete  
**Spec:** [2026-04-01-round-7-remove-deadline-sort-projects-design.md](../specs/2026-04-01-round-7-remove-deadline-sort-projects-design.md)

---

## Goal

Remove the broken **deadline** sort option from the projects **UI** only. **Option A:** keep **`sort=deadline`** in API + repository (no removal).

---

## Files

| Area | Files |
|------|--------|
| UI | `components/projects/projects-list.tsx`, `projects-board.tsx`, `projects-workspace-context.tsx` (sort options) |
| API / Repo | **No change** to `app/projects/route.ts` or `listProjects` deadline branch for Option A |
| Tests | Adjust **UI** tests; **keep** route tests that assert `sort=deadline` still parses |

---

## Tasks

- [x] **Step 1:** Remove “Deadline” from sort control on list + board; default sort control to title or created per existing behavior.
- [x] **Step 2:** (Optional) Normalize URL if `sort=deadline` — **not required** pre-launch per spec.
- [x] **Step 3:** Update tests: remove assertions on Deadline **control** only; retain API tests for `sort=deadline` unless spec changes.
- [x] **Step 4:** Manual: list + board, search still disables sort per existing rules.
- [x] **Step 5:** `npm run test`.

---

## Handoff

- Revisit bookmark URL behavior before public launch if needed (spec § Resolved).
