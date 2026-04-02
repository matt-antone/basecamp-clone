# Round 7 — Financial Rollup saved hours sync — implementation plan

**Status:** Complete (closed 2026-04-01)  
**Spec:** [2026-04-01-round-7-financial-rollup-saved-hours-sync-design.md](../../specs/2026-04-01-round-7-financial-rollup-saved-hours-sync-design.md)

**Resolved:** **Refetch** project bootstrap after successful save (extra GET acceptable).

**Shipped / verified:** `PATCH /projects/[id]/my-hours` reloads authoritative **`project`** + **`userHours`** on the server (`getProject` + `listProjectUserHours` after `setProjectUserHours`) and returns them in the JSON body. Client (`app/[id]/page.tsx` `saveMyHours`) applies `setProject` / `setUserHours` from the response so **Financial Rollup** (derived from that state + `lib/project-financials`) updates without a full page reload. **Dev tested** — rollup matches saved hours.

**Note:** Does not call `loadProjectBootstrap` again; equivalent outcome to a bootstrap refetch for hours-related fields. **Team hours** (`saveArchivedHours`) uses the same pattern via `PATCH /projects/[id]/archived-hours`.

---

## Goal

Ensure **Financial Rollup** totals and per-user rows update immediately after **My Hours** save succeeds using **fresh** `project` + `userHours` from the **`PATCH`** response (or equivalent full bootstrap refetch).

---

## Discovery (before coding)

- [x] Locate `saveMyHours` in `app/[id]/page.tsx` and the existing `loadProjectBootstrap` / `refresh` helper.
- [x] On success: **PATCH response** carries refreshed `project` + `userHours` (see `app/projects/[id]/my-hours/route.ts`).

---

## Files (expected)

| Area | Files |
|------|--------|
| Client | `app/[id]/page.tsx` |
| API | `app/projects/[id]/my-hours/route.ts` |
| Tests | Route/repo coverage as existing |

---

## Tasks

- [x] **Step 1:** Trace current success handler: what state is updated today (`setProject`, `setUserHours`, etc.)?
- [x] **Step 2:** After successful save, apply refreshed **`project` + `userHours`** from API (per spec goal: totals match server).
- [x] **Step 3:** Automated tests — optional; behavior covered by integration with `PATCH` contract.
- [x] **Step 4:** Manual QA on **dev** — save hours; subtotal and grand total update (confirmed 2026-04-01).
- [x] **Step 5:** `npm run test` when touching related code.

---

## Verification

- Saving hours updates Financial Rollup without full page reload.
- No console errors; loading/error states unchanged.
