# Projects workspace UX, home metrics, and FTS search — Design

**Date:** 2026-03-31  
**Status:** Awaiting review  
**Scope:** Post-create navigation, global header rename and simplification, project list metrics, board sorting and card density, performant full-text search across projects and related content, **optional client filter** on all **`GET /projects`** list/search queries (SQL-backed only)

**Workspace `includeArchived` (mandatory):** List/board bootstrap and refresh use **`GET /projects?includeArchived=false`**. See [2026-04-06-projects-workspace-include-archived-policy.md](./2026-04-06-projects-workspace-include-archived-policy.md).

---

## Overview

This change set improves wayfinding after creating a project, surfaces **discussion** and **file** volume on the home project list, makes the **project board** easier to scan (title sort, tighter cards), replaces the misnamed **theme-toggle** shell with a **header** component without project stats, and adds **server-side full-text search** that includes discussions and files while staying indexed and bounded. Users may narrow lists to a **single client** via a **dropdown** (pulldown) beside search; narrowing is enforced in the **API/SQL** layer via **`clientId`**, not by filtering in the browser.

---

## Product rules

| Area | Rule |
|------|------|
| **Create project** | On successful `POST /projects`, the client navigates to **`/{projectId}`** (same segment as today’s project routes). No navigation on validation or Dropbox provisioning failure (existing error behavior). |
| **Home list metrics** | Per project, under the existing tag list: show **discussion count** = `(number of discussion_threads for project) + (number of discussion_comments for project)`; **file count** = `count(*)` of **`project_files`** for that project (all rows; total for the project). |
| **Board** | Within each status column, cards are sorted by **display title** ascending: `(display_name ?? name).localeCompare(...)`, consistent with client grouping in `projects-list-view.tsx`. |
| **Board cards** | Description is limited to **two lines** on the board (`line-clamp-2` or equivalent); full description remains available on project detail and list views. Additional spacing/typography tweaks are allowed so columns read as **compact cards** without changing data. |
| **Header** | Remove **project stats** (active / blocked / archived counts) from the top bar. Rename **`app/theme-toggle.tsx`** → **`app/header.tsx`**, default export renamed (e.g. `SiteHeader` or `Header`); update `app/layout.tsx` and any docs that reference the old filename. Theme switching and nav behavior stay as today unless otherwise noted. |
| **Search (non-empty)** | **Server-only**: debounced requests, **FTS**-backed matching, results ordered by **relevance** (`ts_rank` / `ts_rank_cd` family), then a stable tie-break (e.g. `created_at desc`). Cap result count (recommended **100** max). **Minimum query length** before calling the API (recommended **2** characters) to avoid noisy scans. **Abort** in-flight search when the query changes (and when the client filter changes). |
| **Client filter (UI)** | A **single-select** control (native `<select>` or accessible combinator matching app patterns), labeled clearly (e.g. **Client**). First option = **All clients** (no filter). Remaining options = workspace **`clients`** sorted by display name (e.g. `name`), value = client **`id`**. Placed **adjacent to the search field** on the projects list/board toolbar. |
| **Client filter (behavior)** | The client filter is applied **only in the database / API query** (`WHERE p.client_id = …` when a client is selected), **not** by filtering results in the browser. Changing the selection triggers a **refetch** of **`GET /projects`** (with the same `includeArchived`, **`search`**, and **`clientId`** params as appropriate). The UI must **not** narrow `projects` client-side by `client_id`. |
| **Search (empty) + client** | Initial bootstrap and any “no search text” refresh use **`GET /projects?includeArchived=false`** and, when a client is selected, **`&clientId=<uuid>`**. List and board render the **server-returned** list; **status** chips may still narrow **client-side** only (unchanged), but **client** scope is always query-backed. **Archived** rows are not loaded here — use **`GET /projects/archived`** on the archive screen. |

---

## Search — matching scope

For a non-empty query, a project matches if **any** of the following match FTS (implementation may use `plainto_tsquery('english', ...)` or `websearch_to_tsquery` if product prefers phrase support later):

| Source | Fields |
|--------|--------|
| **Project** | `name`, `description`, `tags` (treat array as searchable text), `project_code`; **client** `name`, `code` (via join, same as archived search today). |
| **Discussions** | `discussion_threads.title`, `discussion_threads.body_markdown` (prefer markdown over `body_html` for index size). |
| **Comments** | `discussion_comments.body_markdown`. |
| **Files** | `project_files.filename`; optionally `dropbox_path` if cheap and indexed (optional in v1 if path search duplicates noise). |

**Archived parity:** Extend **`listArchivedProjectsPaginated`** (or shared predicate) so archived list search uses the **same** FTS rules and ranking strategy, not only `LIKE` on project/client fields.

**Performance (required):**

- Add **GIN** (or equivalent) indexes suitable for FTS on the columns above—e.g. **expression indexes** on `to_tsvector(...)` for projects, threads, comments, and files—so matching uses **index-friendly** plans, not sequential scans on large tables.
- Use **`EXISTS` subqueries** or **`DISTINCT project_id`** patterns; avoid row explosion from joining every comment/file row into the main `SELECT`.
- Do not load the full project list into the browser for “deep” search.

---

## API

### Existing: `GET /projects`

- Handler honors **`includeArchived`**: omit or **`true`** → include archived rows; **`false`** → only **`p.archived = false`**. The **shared workspace client** always passes **`includeArchived=false`** for list/board (see policy doc above). Other callers (e.g. billing, one-off tools) choose explicitly.
- **Extension — `clientId` (always query-scoped):** Optional **`clientId`** query parameter on **every** successful list response path. If present and a **valid UUID**, the repository adds **`and p.client_id = $clientId::uuid`**. If **malformed**, respond **`400`**. If valid UUID but no rows match, return **`{ projects: [] }`** (or normal empty list). **Do not** implement client narrowing only in React.
- **Extension — `search`:** When present and non-empty after trim:
  - Return only **matching** projects in the same JSON shape as today (`{ projects: [...] }`).
  - Apply **FTS + relevance ordering + LIMIT**, **and** apply **`clientId`** in the same query when provided (**AND**).
  - Still respect **`includeArchived`** semantics (if `false`, only non-archived matches).
- When **`search` is absent or empty**, behavior is the **standard list path** (no FTS): same as today **plus** optional **`clientId`** filter on **`p.client_id`**.

### Archived: `GET /projects/archived`

- Align with **`clientId`** on the query: when the archived endpoint supports filters, **`clientId`** narrows **`p.client_id`** in SQL for **both** FTS and non-FTS archived list modes, same rules as `GET /projects`.

**Auth:** Unchanged (`requireUser` / existing patterns on these routes).

---

## Data layer

### `lib/repositories.ts`

- **`listProjects(includeArchived, options?: { clientId?: string | null })`** (and a dedicated **`searchProjects`** or unified entry if cleaner):  
  - **Baseline list:** Add scalar subselects (or lateral aggregates) for **`discussion_count`** and **`file_count`** on every row returned to the client, so bootstrap and list views have counts without N+1:
    - `discussion_count` = `(select count(*) from discussion_threads t where t.project_id = p.id) + (select count(*) from discussion_comments c where c.project_id = p.id)`
    - `file_count` = `(select count(*) from project_files f where f.project_id = p.id)`
  - **`clientId`:** When provided, both **baseline** and **search** SQL paths include **`and p.client_id = $clientId::uuid`** (parameterized).
  - **Search variant:** Single query (or small set) implementing FTS predicates + **`client_id`** filter when set + relevance + limit; return the same columns including **`display_name`** and new count fields where applicable.

- **Types:** Consumers expect optional **`discussion_count`** / **`file_count`** on the **`Project`** type in `projects-workspace-context.tsx` (numbers).

### Migrations (`supabase/migrations/`)

- New migration: enable **`pg_trgm` only if needed** for filenames; **primary** approach is **`to_tsvector` + GIN** indexes on:
  - Project searchable fields (combined vector or expression index).
  - Thread `(title, body_markdown)`.
  - Comment `body_markdown`.
  - File `filename` (consider **`'simple'`** config for names without English stemming if that fits filenames better).

Document index choices in migration comments for future operators.

---

## UI

### Redirect after create

- **`components/projects/projects-workspace-context.tsx`**: In **`createProject`**, after successful `POST`, read **`project.id`** from JSON, call **`router.push(\`/${id}\`)`** (from `next/navigation`), then refresh state as needed (optional `refreshProjects` if staying on index matters for back navigation—product preference: navigation is primary).

### Home list

- **`components/projects/projects-list-view.tsx`**: Below **`ProjectTagList`**, render a single compact line, e.g. **“N discussions · M files”** (exact copy can match product tone), using the new numeric fields. Accessible text: don’t rely on color alone; use semantic text.

### Board

- **`components/projects/projects-board-view.tsx`**: Sort **`columnProjects`** by title; apply **`line-clamp-2`** (or CSS class) to description; adjust card classes in **`app/styles.css`** (or co-located styles) for denser card chrome if needed.

### Header

- **`app/header.tsx`** (renamed from `theme-toggle.tsx`): Remove stats fetch, state, and UI for project counts. Keep theme + auth + top nav. Update **`app/layout.tsx`** import.

### Search input and client filter

- **`components/projects/projects-workspace-context.tsx`**: Bootstrap **`loadProjectsBootstrap`** and **`refreshProjects`** call **`GET /projects?includeArchived=false`** with **`&clientId=`** when the user has selected a client (omit when “All clients”). **Mutations** (create, archive, move status) should **refresh** using the **current** `clientId` (and search params if any) so the list stays consistent.
- **`components/projects/projects-list.tsx`** (toolbar):
  - **Client `<select>`:** bound to **`selectedClientId`** (context or lifted state). On change: update context and **refetch projects** from the API (**no** `projects.filter(p => p.client_id === …)`).
  - **Search:** When **`searchTerm` is non-empty** (and passes min length), debounced **`GET /projects?includeArchived=false&search=...`** plus **`&clientId=...`** when applicable; **`AbortController`**; refetch when **search** or **client** changes.
  - When **`searchTerm` is empty**, refetch uses **`GET /projects?includeArchived=false`** plus optional **`clientId`** only (full list path, server-filtered by client).
- If **`archive-tab`** gains FTS later, add the same **`clientId`** parameter to archived search for parity; until then, archived tab can keep existing filters or document follow-up.
- **State placement:** **`selectedClientId`** and **FTS override list** (if separate from `projects`) live in **`projects-workspace-context.tsx`** so list and board share one server-backed dataset.

**Board + search:** If the board must show only FTS hits when searching, pass the filtered project list from the same source as the list tab; if out of scope for v1, document that **search applies to list view only** and board keeps full `activeProjects` until a follow-up. **Recommendation for this spec:** apply the same filtered project array to **both** list and board when search is active so behavior is consistent.

---

## Testing

| Area | Tests |
|------|--------|
| **POST /projects** | Existing tests; add assertion or integration that response body includes `id` (already true). |
| **GET /projects** | Tests for **`clientId`** **without** `search`: returns only that client’s projects; malformed UUID **400**. **`search` + `clientId`:** FTS hits restricted to that client. |
| **GET /projects?search=** | Match on thread title, filename, no match, limit, **`includeArchived`**, combined with **`clientId`** as above. |
| **Repositories** | Unit or integration tests for FTS predicate or count subqueries if the project already tests SQL helpers. |
| **Board** | Update or add **`projects-board-view`** test: sort order, clamped description class if asserted. |
| **Header** | Smoke: layout renders; no stats snapshot (optional). |

---

## Out of scope

- Search result **snippets** / highlighting in the UI  
- **Reindex** jobs (assume inline `to_tsvector` / indexes sufficient for v1 scale)  
- Changing **Dropbox** or **slug** routing for project URLs  
- **settings** or **feeds** unrelated to this spec  

---

## Compatibility and hygiene

- **`Project`** shape and **`display_name`** formula: unchanged except additive numeric fields.  
- **Supabase schema:** additive migration only; no breaking column renames.  
- **`.env.local`:** do not edit.  
- Update internal docs that cite **`theme-toggle.tsx`** when touching navigation plans.

---

## Self-review checklist

- [x] No conflicting rules with archived vs active search  
- [x] Counts defined unambiguously at project level  
- [x] Performance constraints (indexes, limit, debounce, abort) explicit  
- [x] Board search behavior called out (recommend shared filtered set)  
- [x] Client filter: query-only (SQL/API), refetch on change, never client-side result filtering  
- [x] Workspace **`GET /projects`** uses **`includeArchived=false`**; policy in [2026-04-06-projects-workspace-include-archived-policy.md](./2026-04-06-projects-workspace-include-archived-policy.md)

---

## Implementation order (suggested)

1. Migration + repository FTS + `GET /projects` search + tests  
2. Count subqueries on list query + types + home list UI  
3. Header rename + remove stats  
4. Create redirect  
5. Board sort + line clamp + card density CSS  
6. Wire list/board to shared search results (if not done in step 1)
