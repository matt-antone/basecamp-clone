# Round 7 — Financial Rollup: sync totals after “My Hours” save

**Date:** 2026-04-01  
**Status:** Implemented (closed 2026-04-01)  
**Type:** Bugfix / data consistency

---

## Resolved (2026-04-01)

| Decision | Answer |
|----------|--------|
| **Update strategy** | **Fresh server state after save** — Spec originally preferred **refetch bootstrap**; **implemented** via **`PATCH /projects/[id]/my-hours`** returning refreshed **`project`** and **`userHours`** after `setProjectUserHours` (server `getProject` + `listProjectUserHours`). Client updates state from the response; Financial Rollup recalculates. **Dev verified** 2026-04-01. |

---

## Problem

After the user saves **My Hours** on project detail, the **Financial Rollup** section (per-user rows, hours subtotal, grand total) does not reliably reflect the newly saved values until a full refresh or navigation. Users expect **immediate** consistency between the hours form and rollup math.

---

## Goal

When `saveMyHours` succeeds:

1. **Viewer row** in the rollup shows updated hours.
2. **Hours subtotal** and **grand total** (and any derived `totalArchivedHours` display) recalculate from **fresh** server state.
3. Implementation: **Authoritative** `project` + **`userHours`** returned from **`PATCH /projects/[id]/my-hours`** after `setProjectUserHours` (server reloads rows before responding). Client does **not** need a second `loadProjectBootstrap` call for this fix.

---

## Non-goals

- Changing how hourly rate or expense lines behave unless the same state bug affects them (scope to hours save path first).

---

## Approaches (brainstorm vs shipped)

| Option | Description |
|--------|-------------|
| **Full bootstrap refetch** | Extra client round-trip to `loadProjectBootstrap` — **not** required; **PATCH** payload is sufficient. |
| **Response-driven (shipped)** | **Full** `project` + `userHours` in response — **chosen** for `PATCH` my-hours and archived-hours. |
| **Optimistic local** | Update local row from input only — **not** used. |

---

## Deferred

- **Optional** full bootstrap refetch after save if other bootstrap fields must stay in sync beyond `project` + `userHours` (not needed for rollup today).

---

## Requirements

1. After successful save, rollup **hours column** and **subtotals** match DB within one tick (no manual refresh).
2. Error path: failed save does not corrupt rollup.
3. Unit/integration tests: mock save → assert state or `userHours` update path.

---

## Related code

- `app/[id]/page.tsx` — `saveMyHours`, `myHoursInput`, `userHours`, `hoursSubtotalUsd`, `calculateHoursSubtotalUsd` / `calculateProjectGrandTotalUsd` from `@/lib/project-financials`.
- API: route that persists per-user hours for the project (locate under `app/projects/[id]/` or similar).
