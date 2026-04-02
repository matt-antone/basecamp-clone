# Round 7 — Billing page and lifecycle — implementation plan

**Status:** Complete (closed 2026-04-01)  
**Spec:** [2026-04-01-round-7-billing-page-lifecycle-design.md](../../specs/2026-04-01-round-7-billing-page-lifecycle-design.md)

**Shipped:** Migration `0021_project_status_billing.sql`, `lib/project-status.ts`, `GET /projects?billingOnly=true`, `POST /projects/[id]/status` with transition rules, `/billing` page + nav, board Complete → **Send to billing** / **Archive now**, tests. Optional backfill (A3) not run — confirm with product if needed.

**Resolved:** Archive excludes billing-stage projects; **Billing → In Progress** (reopen) allowed; **Billing → Archive** when done.

---

## Goal

Introduce a **Billing** stage and page; route **Complete → Billing → Archive** per spec, plus **reopen** from Billing.

---

## Phase A — Data model

- [x] **A1:** Inventory current `project.status` values and `archived` semantics in `lib/repositories.ts` + migrations.
- [x] **A2:** Add `billing` (or agreed) status via migration + TS types; document enum in one module.
- [ ] **A3:** Optional backfill script — **confirm with product** before running.

---

## Phase B — API

- [x] **B1:** Extend `GET /projects` (or new `GET /billing`) with filter `status=billing` and `includeArchived=false`.
- [x] **B2:** PATCH project: transitions **complete → billing**, **billing → archived** (`archived=true`), **billing → in_progress** (reopen; `archived=false`).

---

## Phase C — UI

- [x] **C1:** Create `app/billing/page.tsx` (or workspace) reusing list components with billing filter.
- [x] **C2:** Add nav link to global shell/layout.
- [x] **C3:** Update “complete” flow: buttons/dialogs that **previously archived** should now move to **billing** unless “skip” is added.
- [x] **C4:** Billing row action: **Archive** (calls existing archive endpoint with new transition rules).

---

## Phase D — QA

- [ ] **D1:** Manual: complete project → appears Billing → archive → appears Archive only.
- [x] **D2:** `npm run test` — extend `projects-route` / repository tests.

---

## Files (expected)

| Area | Files |
|------|--------|
| Migration | `supabase/migrations/00XX_project_status_billing.sql` (name TBD) |
| Repo | `lib/repositories.ts` |
| Routes | `app/projects/route.ts`, `app/projects/[id]/route.ts` |
| UI | New billing page, nav component, project dialogs |
| Tests | `tests/unit/projects-route.test.ts`, repository tests |

---

## Handoff

- **Schema:** new status enum value + any CHECK constraint updates.
- **User comms:** explain new Billing step for completed work.
