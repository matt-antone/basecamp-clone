# Round 7 — Billing page and project lifecycle (complete → billing → archive)

**Date:** 2026-04-01  
**Status:** Implemented (Round 7 closed)  
**Type:** Feature / workflow

---

## Problem

Today, **completed** work likely flows to **Archive** directly. Product wants an intermediate **Billing** stage: jobs that are **done** but still **revenue/billing-relevant** appear on a **Billing** page before they move to **Archive**.

---

## Resolved (2026-04-01)

| Decision | Answer |
|----------|--------|
| **Archive vs Billing** | **Yes** — **Billing** is an **extra step** inserted between **Complete** and **Archive**. Projects in the billing stage **do not** appear on the **Archive** page. **Archive** lists only projects that are **fully archived** (`archived=true`). Billing-stage projects appear **only** on **Billing** until explicitly moved to Archive. |
| **Revert from Billing** | **Yes** — A project may move **backward** from **Billing** to an active state (e.g. **In Progress**) when work reopens or billing was set too early. Project remains **not archived**; implement a clear primary action on the Billing row/detail. |

---

## Goal

1. Add a **Billing** page (route + nav) listing projects in a **billing** state.
2. **Complete** jobs move to **Billing** (not straight to Archive).
3. From **Billing**, users move projects to **Archive** when appropriate.

---

## Lifecycle (proposed)

```text
… → In Progress → Complete → [Billing] → Archived
```

- **Complete:** existing “done” status or new terminal state — **align with current `project.status` enum** in DB.
- **Billing:** either  
  - **new status** value `billing` (or `ready_for_billing`), or  
  - **boolean** `in_billing` — **prefer single status column** for query simplicity.

---

## UX

| Surface | Behavior |
|---------|----------|
| **Billing** | Table/board similar to projects list: filters, client, totals optional. |
| **Archive** | Only projects **fully archived** (existing `archived` flag or final state). |
| **Actions** | From Billing: **“Send to Archive”** (sets `archived=true`); **“Reopen work”** (or similar) → **In Progress** (or agreed status), leaving `archived=false`. |
| **Complete action** | When user marks **Complete**, transition to **Billing** instead of Archive (unless product wants optional “skip to archive”). |

---

## Data model

- Confirm whether **`archived`** boolean stays the **only** archive flag; **billing** is likely **not archived** (`archived=false`, `status=billing`).
- Migration: add status or enum value; backfill: projects currently “complete and not archived” → optional one-time move to billing (**product decision**).

---

## Non-goals (v1)

- Invoicing PDFs, QuickBooks, or payment capture.
- Changing financial rollup formulas (unless billing page shows rollups — then reuse `lib/project-financials`).

---

## Requirements

1. Nav item: **Billing** between **Projects** and **Archive** (exact order per IA).
2. **Permissions:** same as project list unless specified.
3. **Tests:** repository filter for billing state; route tests for list API if extended.

---

## Open questions

_None — billing lifecycle decisions in § Resolved._

---

## Related

- `app/archive/page.tsx`, `app/flow/page.tsx` — mirror patterns for `app/billing/page.tsx` or similar.
- `lib/repositories.ts` — `listProjects` filters (`includeArchived`, status).
