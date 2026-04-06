# Projects workspace rollup — client filter options, board parity, deadlines, PM note, hours rate & expenses, created date, file linkage — Design

**Date:** 2026-03-31  
**Status:** Approved 

**Resolved (open questions):** (1) **Sort** is **disabled** while search is active — relevance-only ordering. (2) **Invalid client filter:** **disable** the client filter control (do not auto-clear). (3) **`pm_note`** max length **256** characters. (4) **Hourly rate** stored in **Settings**, not on `project_user_hours`. (5) **Default list order** when `sort` omitted: **`created_at desc`** (match current `listProjects` non-search behavior). (6) **v1 hourly rate:** **one global** rate in Settings — **no per-user overrides** in v1.
**Supersedes in part:** [2026-03-31-projects-workspace-ux-search-design.md](./2026-03-31-projects-workspace-ux-search-design.md) — **Client filter dropdown options** (see § Client filter — dropdown options below; SQL-backed `clientId` behavior from that doc remains).

---

## Overview

This spec consolidates a single batch of product changes for the **projects workspace** (list + board), **project detail** (PM note, financial rollup), **date display**, and a **data-quality investigation** for file attachments. It incorporates brainstorm decisions: **client options** follow **visible rows** (including search + list status filter); **deadline sort** puts undated projects **last**; **PM note** is edited only on detail; **hours × rate** uses a **single global hourly rate from Settings** (v1 — not stored per row on **`project_user_hours`**); **expense lines** are new structured data; **created date** on listings is already implemented (see § Created date).

---

## 1. Client filter — dropdown options

### Problem

The **Client** `<select>` currently lists **all workspace clients** from bootstrap. Users want options limited to clients that actually appear in the **current working set** of projects.

### Rules (brainstorm **C** + **option 1**)

| Situation | Dropdown contains |
|-----------|-------------------|
| **No search**, status **All** | Unique `client_id` values from **active projects** returned by `GET /projects` (workspace uses **`includeArchived=false`**; optional `clientId`, optional `search`). See [2026-04-06-projects-workspace-include-archived-policy.md](./2026-04-06-projects-workspace-include-archived-policy.md). |
| **Search active** (≥2 chars, server FTS) | Unique clients among **search result projects** only. |
| **List — status chip** (New / In Progress / …) | Unique clients among projects that match **that status** *and* current server result (search + `clientId`). **Status** continues to narrow **client-side** on the list only; **client scope** for the query stays server-backed per existing spec. |
| **Board** | Same as above **except** there is **no** status chip — options come from **`activeProjects`** after **search** + server **`clientId`** filter. |

**“All clients”** remains the first option. **Implementation:** derive options in the client with `useMemo` from the same array that drives rendered rows (`filteredActiveProjects` on list; board equivalent), **not** from the full `clients` bootstrap list.

### Edge cases

- **Empty result set:** Dropdown may list **no** clients besides “All clients” — acceptable.
- **Stale / invalid `filterClientId`:** If the selected client is **not** in the derived option set (e.g. after a new search or status filter), **disable** the **Client** filter control until context allows a valid choice again (e.g. user **clears search** or **changes status** so the selection is valid, or **explicit “All clients” reset** if provided). **Do not** silently auto-clear the selection unless product later revisits this.

### API

- **No change** to `GET /projects` contract for `clientId` / `search` — still SQL-scoped.

---

## 2. Project board — client filter + search parity

### Rules

- Reuse **single workspace state**: `filterClientId`, `activeSearch`, `refreshProjects` (same as list).
- Add the **Client** control and **search** field to the **board** shell/toolbar (layout matches list patterns: adjacent controls, same debounce / min search length as list).
- **Refetch** on client or search change; board columns render **server-returned** projects (no client-side filter for client scope).

---

## 3. Deadlines — display, locale, sort

### Display

- Show **deadline** on **project list** rows and **board** cards (in addition to any existing detail surfaces).
- Format as the user’s **local calendar date** (same approach as **created date** listing: avoid off-by-one from UTC; use `Date` + `toLocaleDateString` / shared helper pattern).

### Sort (projects page — list + board)

- **Control:** User-selectable sort, at minimum: **Title (A–Z)** and **Deadline (soonest first)** — **only when search is inactive** (no FTS query).
- **While search is active:** **Disable** the sort control in the UI. **`GET /projects?search=…`** continues to use **FTS relevance** ordering only (existing behavior: rank desc, then `created_at desc` tie-break — see `listProjects` in `lib/repositories.ts`). **`sort`** query param is **ignored** or rejected when `search` is present (implementation choice: ignore is simpler).
- **Deadline sort (brainstorm A):** Order by deadline **ascending**; projects **without** a deadline come **after** all dated projects. **Within** the undated group: **title A–Z** (stable tie-break).
- **Title sort:** `(display_name ?? name)` ascending (align with existing board column sort where applicable).
- **Default (no `sort` param, no `search`):** **`ORDER BY p.created_at desc`** — same as current baseline `listProjects` list path.

### API

- Extend **`GET /projects`** with optional **`sort`** query param, e.g. `sort=title|deadline`, **only meaningful when `search` is absent or empty**; otherwise **ignore** `sort` (or return **400** if both sent — prefer **ignore** for simpler clients).

### Repository

- `ORDER BY` for deadline: `deadline ASC NULLS LAST` (Postgres), then title tie-break.

---

## 4. PM note (internal listing note)

### Rules (brainstorm **A**)

- **Edit:** Only on **project detail** (or existing project edit dialog / settings area) — **not** inline on list/board.
- **List + board:** **Read-only**, **one line** with **ellipsis** when present; full text on detail.

### Data

- New nullable column on **`projects`**, e.g. **`pm_note text`**, **max length 256** characters, plain text for v1.
- **PATCH /projects/:id** (or existing update route) extends payload + validation.
- Optional: include in FTS later — **out of scope** for v1 unless requested.

---

## 5. Hours rate, line costs, expenses, totals

### Existing behavior (not new)

- Hours are stored per **(project, user)** in **`project_user_hours`** (`setProjectUserHours`, `listProjectUserHours`).
- Users save **their** hours via **`PATCH /projects/:id/my-hours`**; archived projects may use **`PATCH /projects/:id/archived-hours`** for per-user rows.
- **This spec does not replace** that workflow — it **adds** rate, computed line cost, expense lines, and rollups.

### New / extended behavior

| Piece | Rule |
|-------|------|
| **Hourly rate** | **v1:** **One global** value in **Settings** (workspace-wide), **not** on **`project_user_hours`**. **Default 150.00 USD** when unset. **Per-user overrides are out of scope for v1.** |
| **Line cost (hours)** | For each **`project_user_hours`** row: **`hours × global_rate`** (same rate for every user on every project). Show as a clear **line amount** in the hours UI. |
| **Hours subtotal** | Sum of line costs for all **`project_user_hours`** rows on the project. |
| **Expense lines** | New child records: **editable label**, **amount**; optional **sort order**; **expense subtotal** = sum of amounts. |
| **Grand total** | **Hours subtotal + expense subtotal** (currency display **USD**, two decimals, unless product later adds multi-currency). |

### Data model (recommended direction)

- **`project_user_hours`:** **No new rate column** — continues to store **`hours`** only (existing schema). **Rate** is read from **Settings** at display/calculation time.
- **Settings (v1):** A **single** stored **global default hourly rate** (**150.00 USD** initial default). **No** per-user rate columns or overrides in v1; a later version may add per-user billing rates without changing **`project_user_hours`**.
- **New table** e.g. **`project_expense_lines`** (`project_id`, `label`, `amount`, `sort_order`, timestamps) — **prefer table** for validation and reporting. Amounts as **`numeric(12,2)`** USD or integer cents — pick one in implementation and test rounding.

### API / UI

- **Hours** responses continue to expose **`hours`** per user; **client or server** computes **line cost** using the **global rate from Settings** × hours for each **`listProjectUserHours`** row.
- New or extended **Settings** API for the **single global hourly rate** read/update (follow existing settings patterns in the app).
- New routes or nested resources for **CRUD** expense lines under a project (follow existing auth patterns).
- **Detail page** (or dedicated section): hours table with **hours**, **$/h** (same global value for all rows, from Settings), **line cost**; expense lines; **subtotals** and **grand total**.

---

## 6. Created date on listings

### Status

**Implemented:** Project **list** and **board** show **created** metadata on the **same line as the title**: **`· {local short date}`** after the linked title, smaller + muted (`.projectCreatedMeta`), `<time dateTime="...">`. Helper: **`formatProjectCreatedAtLocal`** in `lib/project-utils.ts`; **`Project.created_at`** on client.

### API

- **`GET /projects`** already returns `p.*` including **`created_at`** — no contract change required for display.

---

## 7. Files missing discussion / comment linkage

### Problem

Users expect files to be tied to a **discussion or comment**. The schema allows **`thread_id`** / **`comment_id`** on **`project_files`**; many rows may be **null** — some expected, but counts are higher than expected.

### Non-UI phase (required)

1. **Query:** Count / sample `project_files` where **`thread_id is null and comment_id is null`** (per project or global).
2. **Trace:** Upload-complete path, import/migration scripts, and deletes — ensure **`threadId` / `commentId`** are persisted when users attach to comments.
3. **Outcome:** Either **fix bugs** (race, missing params), **backfill** where possible, or **document** legitimate orphan cases (e.g. direct upload without thread).

### Deliverable

- Short **incident-style note** or ticket with root cause + fix; **tests** for any code path change.

---

## Implementation order (suggested)

1. **Client dropdown options** (derived list) + **board** toolbar parity (client + search).  
2. **Deadlines** visible + **local** format + **`sort`** on `GET /projects` + UI control.  
3. **`pm_note`** migration + detail edit + list/board read-only snippet.  
4. **Settings** hourly rate (default **$150**) + line costs from existing **`project_user_hours`** + **expense lines** + totals.  
5. **File linkage** investigation and fixes.  
6. **Created date** — already shipped; verify in QA.

---

## Testing expectations

- **Unit / integration:** Repositories and routes for **`sort`** (non-search paths), **`pm_note`** (256 max), **Settings** rate, **expense lines**; existing **`my-hours`** / **`archived-hours`** behavior preserved.  
- **UI:** List + board share filter state; deadline sort matches server order; PM note truncation; totals arithmetic with rounding rules (document half-up to two decimals for USD).

---

## Compatibility

- **Supabase:** New columns / tables require migrations; treat as **compatibility-sensitive** per project rules.  
- **No** `.env.local` changes unless new services are introduced (none in this spec).

---

## References

- [2026-03-31-projects-workspace-ux-search-design.md](./2026-03-31-projects-workspace-ux-search-design.md) — FTS, `clientId` query semantics.  
- `supabase/migrations/0009_project_user_hours.sql` — **`project_user_hours`**.  
- `app/projects/[id]/my-hours/route.ts`, `app/projects/[id]/archived-hours/route.ts` — hours API.
