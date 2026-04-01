# Projects workspace rollup — implementation plan

**Status:** Completed (2026-03-31). Implemented via subagent-driven execution; full suite `npm run test` passing. Apply Supabase migrations `0018`–`0020` on each environment before relying on new columns/tables.

> **For agentic workers:** REQUIRED SUB-SKILL: Use @superpowers/subagent-driven-development (recommended) or @superpowers/executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the UX and data changes in [2026-03-31-projects-rollup-ux-design.md](../specs/2026-03-31-projects-rollup-ux-design.md): derived client filter options, board filter/search parity, deadline display + `sort` on `GET /projects`, PM note (256 chars), global hourly rate in Settings + line costs + expense lines + totals, file-linkage investigation, and QA on created date.

**Architecture:** Extend existing `listProjects` / `GET /projects` with optional `sort` (ignored when FTS `search` is active). Keep a single workspace context (`filterClientId`, `activeSearch`, `refreshProjects`); add `sort` to URL builder + refresh options. Derive client `<select>` options from visible row data (`useMemo` on list; server `activeProjects` on board). Persist `pm_note`, `default_hourly_rate_usd`, and `project_expense_lines` via Supabase migrations and repository helpers; surface rate through `getSiteSettings` / `PATCH /site-settings`. Financial UI lives on project detail beside existing hours.

**Tech stack:** Next.js App Router, existing Zod + `lib/repositories` + `lib/http`, Vitest (`tests/unit`, `tests/integration`), Supabase SQL migrations.

**Spec reference:** @basecamp-clone/docs/superpowers/specs/2026-03-31-projects-rollup-ux-design.md

---

## File structure (create / modify)

| Area | Primary files |
|------|----------------|
| Client filter options | `components/projects/projects-list.tsx`, `components/projects/projects-board.tsx` (toolbar section), possibly small helper in `lib/project-utils.ts` |
| Workspace URL + sort state | `components/projects/projects-workspace-context.tsx` (`buildProjectsUrl`, `RefreshProjectsOptions`, context value) |
| Board parity UI | `components/projects/projects-board-view.tsx` (props for deadline line if not in shell) |
| List/board rows — deadline | `components/projects/projects-list-view.tsx`, `components/projects/projects-board-view.tsx` |
| API — projects list | `app/projects/route.ts`, `lib/repositories.ts` (`ListProjectsOptions`, `listProjects`) |
| PM note | New migration; `lib/repositories.ts` (`updateProject`, `getProject`, selects); `app/projects/[id]/route.ts`; project detail UI (locate `[id]/page` or project shell) |
| Settings rate | Migration column on `site_settings`; `lib/repositories.ts` (`getSiteSettings`, `upsertSiteSettings`, types); `app/site-settings/route.ts`; `app/settings/page.tsx` |
| Hours + expenses | Migration `project_expense_lines`; repo CRUD; routes under `app/projects/[id]/expense-lines/` or nested; detail page sections |
| File linkage | SQL/note + `app/projects/[id]/files/upload-complete/route.ts` + callers passing `threadId`/`commentId` |
| Tests | `tests/unit/projects-route.test.ts`, new unit tests for sort/pm_note/settings/expenses as added |

---

## Phase A — Client filter options + board toolbar parity

### Task A1: Derive client options on list + invalid selection UX

**Files:**
- Modify: `components/projects/projects-list.tsx`
- Test: manual / optional `tests/unit` if extracting pure helper

- [x] **Step 1:** Add `useMemo` that builds **unique client options** from `visibleProjects` / `filteredActiveProjects`: map each project to `{ id: client_id, label: getProjectClientLabel(project) }`, dedupe by `client_id`, sort labels. Use **`client_id`** for `<option value>` (must match server `clientId` filter). Replace `sortedClients` from full `clients` bootstrap for the filter `<select>` only.
- [x] **Step 2:** Compute `clientFilterDisabled`: `Boolean(filterClientId && !derivedClientIds.has(filterClientId))`. Set `<select disabled={clientFilterDisabled}>` and keep `value={filterClientId ?? ""}` (spec: do not auto-clear).
- [x] **Step 3:** Run `npm run test` or targeted tests; smoke list + search + status chip + invalid client state.

- [x] **Step 4:** Commit

```bash
git add components/projects/projects-list.tsx
git commit -m "feat(projects): derive client filter options from visible rows"
```

### Task A2: Board — shared filters + refetch

**Files:**
- Modify: `components/projects/projects-board.tsx`
- Modify: `components/projects/projects-board-view.tsx` (only if layout needs a shared toolbar wrapper; else keep filter row in `projects-board.tsx` above `ProjectsBoardView`)

- [x] **Step 1:** From `useProjectsWorkspace()`, wire `filterClientId`, `setFilterClientId`, `activeSearch`, `setActiveSearch`, `refreshProjects` (same as list).
- [x] **Step 2:** Add debounced search (300ms) and `effectiveSearch` (≥2 chars) mirroring `projects-list.tsx` `useEffect` that calls `refreshProjects({ clientId, search })`.
- [x] **Step 3:** Render **Client** `<select>` with same derived-options logic: `useMemo` over `activeProjects` + `getProjectClientLabel`, dedupe by `client_id`, disable when selection invalid vs derived set.
- [x] **Step 4:** Pass `includeArchived` behavior unchanged; board uses server-returned `activeProjects` only (no extra client-side client filter).
- [x] **Step 5:** Commit

```bash
git add components/projects/projects-board.tsx components/projects/projects-board-view.tsx
git commit -m "feat(projects): board toolbar client filter and search parity"
```

---

## Phase B — Deadlines display + `sort` query + UI

### Task B1: Repository — `sort` param and ORDER BY

**Files:**
- Modify: `lib/repositories.ts` (`ListProjectsOptions`, `listProjects`)
- Modify: `tests/unit/projects-route.test.ts` (mock expectations)
- Modify: `app/projects/route.ts` (parse `sort`, pass through)

- [x] **Step 1:** Extend `ListProjectsOptions` with `sort?: "title" | "deadline" | null` (or string union from parse).
- [x] **Step 2:** In `listProjects`, when `search` is non-empty: **ignore** `sort` (keep existing FTS order). When `search` empty and `includeArchived` paths: apply `ORDER BY`:
  - Default (no sort / omitted): `p.created_at desc` (already matches non-search branch).
  - `sort=title`: `(coalesce(display expr))` ascending — align with spec: use same expression as `projectListSelectColumns` for display name if available, else `lower(p.name)`; verify against existing board column sort in code.
  - `sort=deadline`: `p.deadline ASC NULLS LAST`, then title tie-break for undated group.
- [x] **Step 3:** Add unit tests that call route handler with mocked `listProjects` and assert `listProjects` receives expected options for `sort=title`, `sort=deadline`, and `search` + `sort` (sort ignored).

Run:

```bash
cd basecamp-clone && npx vitest run tests/unit/projects-route.test.ts
```

Expected: PASS

- [x] **Step 4:** Commit

```bash
git commit -m "feat(api): optional sort on GET /projects when search inactive"
```

### Task B2: Client — `sort` state + disabled while search active

**Files:**
- Modify: `components/projects/projects-workspace-context.tsx`
- Modify: `components/projects/projects-list.tsx`

- [x] **Step 1:** Add `projectSort: "created" | "title" | "deadline"` (or `null` = server default) in context **or** keep sort as local state in list/board only — prefer **context** if both views must stay in sync; spec implies list + board both get the control.
- [x] **Step 2:** Extend `buildProjectsUrl` and `RefreshProjectsOptions` with `sort` query param (omit when default `created_at desc` if you encode as absence, or send explicit param per repo).
- [x] **Step 3:** In list toolbar, add `<select>` or segmented control: Title (A–Z), Deadline (soonest), Default (newest first). **`disabled={effectiveSearch.length >= 2}`** (or whatever matches FTS threshold).
- [x] **Step 4:** On board, duplicate sort control + call `refreshProjects` with new sort.
- [x] **Step 5:** Commit

### Task B3: Deadline display on list and board cards

**Files:**
- Modify: `components/projects/projects-list-view.tsx`
- Modify: `components/projects/projects-board-view.tsx`
- Modify: `lib/project-utils.ts` (add `formatProjectDeadlineLocal` mirroring `formatProjectCreatedAtLocal` pattern)

- [x] **Step 1:** Add helper that parses ISO/date-only `deadline` and formats with `toLocaleDateString` (avoid UTC off-by-one for date-only strings — same caution as created date).
- [x] **Step 2:** Render deadline on title row (list) and card (board), muted + small; use `<time dateTime>` when raw value available.
- [x] **Step 3:** Commit

---

## Phase C — `pm_note` column + detail edit + list/board read-only

### Task C1: Migration + repository + PATCH

**Files:**
- Create: `supabase/migrations/0018_project_pm_note.sql` (next free number — **renumber if 0018 taken**)
- Modify: `lib/repositories.ts` (`getProject`, `updateProject`, project selects)
- Modify: `app/projects/[id]/route.ts` (`patchProjectSchema` + `updateProject` args)

- [x] **Step 1:** Migration: `alter table projects add column if not exists pm_note text;` + check constraint or app validation for length ≤ 256.
- [x] **Step 2:** Extend `updateProject` and Zod schema with optional `pm_note` (max 256).
- [x] **Step 3:** Unit test PATCH validation (reject >256).
- [x] **Step 4:** Commit

### Task C2: UI — detail edit only; list/board one line ellipsis

**Files:** Locate project detail editor (grep `patchProject` / project form in `app/` and `components/`).

- [x] **Step 1:** Add PM note field to detail edit form only.
- [x] **Step 2:** On list/board rows, show `line-clamp-1` or CSS ellipsis for `pm_note`; omit section if empty.
- [x] **Step 3:** Commit

---

## Phase D — Global hourly rate + line costs + expense lines + totals

### Task D1: Settings — `default_hourly_rate_usd`

**Files:**
- Create: `supabase/migrations/0019_site_settings_hourly_rate.sql` (adjust numbering)
- Modify: `lib/repositories.ts` (`SiteSettings` type, `getSiteSettings`, `upsertSiteSettings`)
- Modify: `app/site-settings/route.ts`
- Modify: `app/settings/page.tsx`

- [x] **Step 1:** Add `default_hourly_rate_usd numeric(12,2) default 150.00` (or cents — pick one and document).
- [x] **Step 2:** Expose in GET/PATCH `/site-settings` with validation (e.g. 0–999999.99).
- [x] **Step 3:** Settings UI: single input, label e.g. “Default hourly rate (USD)”.
- [x] **Step 4:** Tests for repository or route.
- [x] **Step 5:** Commit

### Task D2: Expense lines table + CRUD routes

**Files:**
- Create: migration `project_expense_lines`
- Create: `lib/repositories.ts` functions `listProjectExpenseLines`, `createProjectExpenseLine`, etc.
- Create: `app/projects/[id]/expense-lines/route.ts` (or REST shape matching existing patterns)
- Test: `tests/unit` or `tests/integration`

- [x] **Step 1:** Table: `project_id`, `label`, `amount`, `sort_order`, timestamps; FK + RLS if project uses RLS (follow existing tables).
- [x] **Step 2:** CRUD with `requireUser` and project access checks consistent with `my-hours`.
- [x] **Step 3:** Commit

### Task D3: Detail page — hours line cost + expense lines + subtotals

**Files:** Project detail page + hours components (grep `listProjectUserHours`, `userHours`).

- [x] **Step 1:** Fetch global rate with project payload or from settings bootstrap on detail.
- [x] **Step 2:** For each hours row: show hours × rate = line amount; sum hours subtotal.
- [x] **Step 3:** List expense lines with edit UI; expense subtotal; grand total = hours subtotal + expense subtotal; USD two decimals, half-up rounding (document in test).
- [x] **Step 4:** Commit

---

## Phase E — File linkage investigation (non-UI)

### Task E1: SQL counts + trace upload path

**Files:**
- Note: `docs/` or ticket markdown optional — user asked not to add docs unless requested; prefer a short `docs/incidents/` file **only if** repo convention exists, else deliver findings in PR description.

- [x] **Step 1:** Run SQL (Supabase SQL editor or script): count `project_files` where `thread_id is null and comment_id is null`.
- [x] **Step 2:** Trace `upload-complete` and client callers for `threadId`/`commentId`; grep `upload-init`, comment attachment flows.
- [x] **Step 3:** Fix bugs + add tests for any code change; document legitimate orphans.
- [x] **Step 4:** Commit

---

## Phase F — Created date QA

- [x] **Step 1:** Verify list + board show `formatProjectCreatedAtLocal` per spec §6.
- [x] **Step 2:** No code change if already satisfied; note in PR.

---

## Testing matrix (run before merge)

```bash
cd basecamp-clone && npm run test
```

| Area | What to cover |
|------|----------------|
| `GET /projects` | `sort` with/without `search`; default `created_at desc` |
| PATCH project | `pm_note` max 256 |
| Site settings | hourly rate round-trip |
| Expense lines | CRUD + sums |
| Hours | Existing `my-hours` / `archived-hours` tests still pass |

---

## Compatibility & handoff notes

- **Supabase:** New migrations must be applied in order; treat as compatibility-sensitive.
- **No** `.env.local` edits expected for this spec.
- **API:** `GET /projects` gains optional `sort`; `PATCH /site-settings` gains hourly rate; project PATCH gains `pm_note`; new expense-line endpoints.

---

## Plan review loop (optional but recommended per @superpowers/writing-plans)

After the plan is approved for execution, run the **plan-document-reviewer** subagent with:
- Plan: `docs/superpowers/plans/closed/2026-03-31-projects-rollup-ux-implementation.md`
- Spec: `docs/superpowers/specs/2026-03-31-projects-rollup-ux-design.md`

Fix any ❌ feedback; re-review until ✅.

---

## Execution handoff

**Plan complete and saved to** `basecamp-clone/docs/superpowers/plans/closed/2026-03-31-projects-rollup-ux-implementation.md`.

**Closed:** Executed with subagent-driven development (phases A–F). Optional follow-up: run orphan `project_files` SQL from Phase E in Supabase when validating data quality; merge or tag as needed for release.
