# Projects workspace UX, metrics, FTS search, and client filter — Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do **one task at a time**; run targeted tests after each task.

**Spec (source of truth):** [docs/superpowers/specs/2026-03-31-projects-workspace-ux-search-design.md](../specs/2026-03-31-projects-workspace-ux-search-design.md)

**Errata (2026-04-06):** Workspace **`refreshProjects` / `loadProjectsBootstrap`** use **`includeArchived=false`**, not `true`. Canonical policy: [2026-04-06-projects-workspace-include-archived-policy.md](../specs/2026-04-06-projects-workspace-include-archived-policy.md). Task 6 Step 3 below originally said `true`; follow the policy doc.

**Goal:** Ship post-create redirect to the new project, SQL-backed **`clientId`** filter and FTS **`search`** on **`GET /projects`**, discussion/file counts on the home list, compact sorted board cards, rename global **`theme-toggle`** to **`header`** without project stats, and shared list/board data when search or client filter is active.

**Architecture:** Add a Supabase migration with GIN/expression indexes for FTS; extend **`lib/repositories.ts`** with parameterized **`clientId`**, optional **`searchProjects`** (or unified **`listProjects`** options), and count subqueries on list rows; extend **`app/projects/route.ts`** (and archived route) query parsing; lift **`selectedClientId`** and search-driven refetch into **`projects-workspace-context.tsx`** so **`activeProjects`** reflects server-backed scope for both list and board; UI debouncing + **`AbortController`** for search.

**Tech Stack:** Next.js App Router, PostgreSQL (`to_tsvector` / GIN), existing `query()` helper, Vitest, Zod on routes as needed.

**Verification (full pass):** `cd basecamp-clone && npx tsc --noEmit && npm run test`

---

## File map

| File | Role |
|------|------|
| `supabase/migrations/00xx_projects_fts.sql` (new) | `btree` on `projects.client_id` if missing; GIN indexes on FTS expressions for projects, threads, comments, files (per spec) |
| `lib/repositories.ts` | `listProjects(…, { clientId?, … })`; optional `search` path with EXISTS + `ts_rank`, LIMIT 100; counts on baseline list; `listArchivedProjectsPaginated` FTS + `clientId` parity |
| `app/projects/route.ts` | Parse `search`, `clientId` (UUID Zod); `400` on bad UUID; wire to repository |
| `app/projects/archived/route.ts` | Parse `clientId`; auth if sibling routes use it—match existing pattern; pass through to repository |
| `components/projects/projects-workspace-context.tsx` | `Project` type `discussion_count`, `file_count`; `selectedClientId`; `searchQuery` / debounced fetch; `refreshProjects({ clientId, search })`; `loadProjectsBootstrap` with same params; `createProject` → `router.push` + response parse |
| `components/projects/projects-list.tsx` | Client `<select>`; wired to context; search input triggers refetch (not client-side deep filter); status filter stays local |
| `components/projects/projects-board.tsx` | No separate project source: consume context `activeProjects` (already derived from `projects`) |
| `components/projects/projects-list-view.tsx` | “N discussions · M files” under tags; extend `ProjectListItem` props |
| `components/projects/projects-board-view.tsx` | Sort column cards by title; `line-clamp-2` on description |
| `app/styles.css` (or relevant) | Denser `.projectFlowCard` / board column spacing |
| `app/theme-toggle.tsx` → `app/header.tsx` | Rename file; default export `SiteHeader`; remove stats API/state/UI; keep `projectsNavHighlight` |
| `app/layout.tsx` | Import `./header` |
| `docs/superpowers/plans/closed/2026-03-31-projects-workspace-routes.md` | Update references `theme-toggle` → `header` (historical accuracy) |
| `tests/unit/projects-route.test.ts` (or new) | `GET` `clientId`, `search`, combined, `400` |
| `tests/unit/projects-board-view.test.tsx` | Sort + clamp if testable |
| `tests/unit/*repositories*` | Add only if repo tests exist for SQL helpers |

---

### Task 1: Migration — FTS and client lookup index

**Files:**
- Create: `supabase/migrations/00xx_projects_search_fts.sql` (use next sequential number in repo)
- Reference: spec “Search — matching scope” and “Migrations”

- [ ] **Step 1:** List existing migrations; pick next `00xx_` prefix.

- [ ] **Step 2:** Add `create index … on projects (client_id)` **if** not already present (check prior migrations / `\d projects` locally).

- [ ] **Step 3:** Add GIN indexes on `to_tsvector` expressions for:
  - projects: combined `name`, `description`, `tags`, `project_code` (English or simple—document in migration comment)
  - `discussion_threads`: `title` + `body_markdown`
  - `discussion_comments`: `body_markdown`
  - `project_files`: `filename` (`simple` ok)

- [ ] **Step 4:** Apply migration in dev; confirm no errors.

- [ ] **Step 5:** Commit migration only.

---

### Task 2: Repository — baseline list with `clientId` and counts

**Files:**
- Modify: `lib/repositories.ts`
 Test: extend or add route/repo tests after Task 4 validates behavior

- [ ] **Step 1:** Extend `listProjects(includeArchived, options?)` with optional `clientId: string | null`. Append **`and p.client_id = $n::uuid`** when set; use same column list and `display_name` expression as today.

- [ ] **Step 2:** Add scalar subqueries (or single lateral) for **`discussion_count`** (threads + comments) and **`file_count`** on each returned row.

- [ ] **Step 3:** Run **`npx tsc --noEmit`**.

- [ ] **Step 4:** Commit.

---

### Task 3: Repository — `search` FTS path

**Files:**
- Modify: `lib/repositories.ts`

- [ ] **Step 1:** Implement `searchProjects` (or branch inside `listProjects` when `search.trim()` non-empty): `plainto_tsquery('english', $search)` (or spec-approved variant); match via project vector OR EXISTS on threads/comments/files per spec; **AND** optional `client_id`; **`order by ts_rank… desc, p.created_at desc`**, **`limit 100`**.

- [ ] **Step 2:** Ensure return columns match list shape including **`display_name`**, **`discussion_count`**, **`file_count`** (same subqueries as baseline or cheap reuse).

- [ ] **Step 3:** `tsc --noEmit`.

- [ ] **Step 4:** Commit.

---

### Task 4: `GET /projects` — query params and errors

**Files:**
- Modify: `app/projects/route.ts`
- Modify: `tests/unit/projects-route.test.ts` (or create)

- [ ] **Step 1:** Parse `clientId` with Zod optional `z.string().uuid()`; on invalid → **`badRequest`** / 400.

- [ ] **Step 2:** Parse `search` trim; if non-empty → call FTS path; else baseline `listProjects` with `clientId`.

- [ ] **Step 3:** Write tests: `clientId` only returns subset; bad UUID 400; `search` hits thread title (seed or mock repository if tests mock DB).

- [ ] **Step 4:** `npm run test -- tests/unit/projects-route` (adjust path).

- [ ] **Step 5:** Commit.

---

### Task 5: Archived projects — `clientId` + FTS parity

**Files:**
- Modify: `lib/repositories.ts` — `listArchivedProjectsPaginated`
- Modify: `app/projects/archived/route.ts`
- Modify: `components/projects/archive-tab.tsx` if it must pass `clientId` (optional for v1 per spec—**if** archive stays LIKE-only, document in plan header as follow-up; spec asks parity—**prefer** implementing `clientId` + FTS for archived in this task)

- [ ] **Step 1:** Add optional `clientId` to archived list SQL (`and p.client_id = …`).

- [ ] **Step 2:** Replace or extend search leg with same FTS predicate as active search (when `search` non-empty).

- [ ] **Step 3:** Route parses `clientId`; pass to repository.

- [ ] **Step 4:** Tests if archive route tests exist; else smoke manual.

- [ ] **Step 5:** Commit.

---

### Task 6: Workspace context — `clientId`, search refetch, shared `projects`

**Files:**
- Modify: `components/projects/projects-workspace-context.tsx`
- Possibly: `lib/browser-auth` usage unchanged

- [ ] **Step 1:** Add **`discussion_count`**, **`file_count`** to `Project` type.

- [ ] **Step 2:** State: **`selectedClientId: string | null`** (null = all). Persist optional: **`sessionStorage`** key only if product asks—in spec default is refetch on change only.

- [ ] **Step 3:** **`refreshProjects`**: build URL **`/projects?includeArchived=false`** + `&clientId=` + `&search=`; use **`authedJsonFetch`**; **`setProjects`**. (Errata: was `true` in original plan; see policy doc.)

- [ ] **Step 4:** **`loadProjectsBootstrap`**: same URL building—**initial load** uses null client + empty search OR read from state (if lifting initial client from URL later, YAGNI unless needed).

- [ ] **Step 5:** Expose setters / `selectedClientId` on context for list toolbar.

- [ ] **Step 6:** After **`moveProject`**, **`toggleArchive`**, **`createProject`** (if user returns), call **`refreshProjects`** with **current** `clientId` + active search string.

- [ ] **Step 7:** `tsc`; manual smoke list + board.

- [ ] **Step 8:** Commit.

---

### Task 7: List toolbar — client select + debounced search

**Files:**
- Modify: `components/projects/projects-list.tsx`

- [ ] **Step 1:** Render **Client** `<select>`: first option “All clients”, then `clients.sort((a,b) => a.name.localeCompare(b.name))`.

- [ ] **Step 2:** `onChange` → set context `selectedClientId` → **`refreshProjects`** (or effect keyed on `selectedClientId` + empty search—avoid double fetch).

- [ ] **Step 3:** Search input: debounce **~300ms**; min length **2** before FTS request; **`AbortController`** per request; pass **`search`** + **`clientId`** to fetch.

- [ ] **Step 4:** When search cleared, refetch without `search` (still with `clientId` if set).

- [ ] **Step 5:** Confirm **no** `projects.filter(p => p.client_id === ...)`.

- [ ] **Step 6:** Commit.

---

### Task 8: Home list metrics UI

**Files:**
- Modify: `components/projects/projects-list-view.tsx`

- [ ] **Step 1:** Extend `ProjectListItem` with optional `discussion_count`, `file_count`.

- [ ] **Step 2:** Below **`ProjectTagList`**, add one line: e.g. **“{n} discussions · {m} files”** with sane defaults when undefined (0).

- [ ] **Step 3:** A11y: visible text, no color-only meaning.

- [ ] **Step 4:** Commit.

---

### Task 9: Board — sort, two-line description, density

**Files:**
- Modify: `components/projects/projects-board-view.tsx`
- Modify: `app/styles.css`
- Modify: `tests/unit/projects-board-view.test.tsx`

- [ ] **Step 1:** After `filter` for column, **`.sort((a,b) => (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name))`**.

- [ ] **Step 2:** Description element: **`line-clamp-2`** (Tailwind class or CSS).

- [ ] **Step 3:** Tighten card padding/typography in CSS for `.projectFlowCard` / `.projectFlowCardBody` **without** breaking drag handles.

- [ ] **Step 4:** Update unit test if it asserts order or class names.

- [ ] **Step 5:** Commit.

---

### Task 10: Header rename and remove stats

**Files:**
- Rename/move: `app/theme-toggle.tsx` → `app/header.tsx`
- Modify: `app/layout.tsx`
- Modify: `docs/superpowers/plans/closed/2026-03-31-projects-workspace-routes.md` (replace `theme-toggle` references with `header`)
- Modify: `docs/superpowers/specs/2026-03-31-projects-workspace-ux-search-design.md` only if paths in spec still say old filename post-implementation (optional)

- [ ] **Step 1:** Remove **`projectStats`** state, fetch, and UI from component.

- [ ] **Step 2:** Rename default export to **`SiteHeader`** (or **`Header`**) and update `layout.tsx` import.

- [ ] **Step 3:** Grep repo for `theme-toggle` / `ThemeToggle`; fix imports.

- [ ] **Step 4:** Run app locally: nav + theme still work.

- [ ] **Step 5:** Commit.

---

### Task 11: Redirect after create project

**Files:**
- Modify: `components/projects/projects-workspace-context.tsx`

- [ ] **Step 1:** `useRouter` from `next/navigation` inside provider (already client).

- [ ] **Step 2:** In **`createProject`**, parse JSON response for **`project.id`** on success; **`router.push(\`/${id}\`)`**; handle non-JSON error paths unchanged.

- [ ] **Step 3:** Do not redirect on Dropbox rollback errors.

- [ ] **Step 4:** Commit.

---

### Task 12: Final verification and checklist

- [ ] **Step 1:** `npx tsc --noEmit`

- [ ] **Step 2:** `npm run test`

- [ ] **Step 3:** Manual: create project → lands on project page; client dropdown → network shows `clientId` only on server; search with 2+ chars → FTS; board matches list scope when searching; header has no stats.

- [ ] **Step 4:** Mark this plan **CLOSED** in a trailing line when done (mirror `2026-03-31-projects-workspace-routes.md`).

---

## Notes and risks

- **Bootstrap timing:** First paint may load all projects; once **`selectedClientId`** is set, refetch immediately—avoid flash of unfiltered data if needed via loading state (YAGNI unless UX bug).
- **Archive tab client filter:** If archive UI has no client dropdown in v1, still implement **`clientId`** on API for consistency; UI can follow in same task or small follow-up.
- **MCP / RLS:** If Supabase RLS applies, verify `clientId` cannot leak other tenants (app may be service-role only—follow existing auth).
- **Do not** edit `.env.local`.

---

## Out of scope (from spec)

Search snippets, offline reindex jobs, Dropbox URL changes, unrelated settings/feeds.
> **STATUS: CLOSED** (2026-03-31) — Projects workspace UX/search/filter implementation is complete and verified with `npx tsc --noEmit` and `npm run test`.
