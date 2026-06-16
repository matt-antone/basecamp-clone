# Plan: Per-User Project Favorites + Favorites View (Consensus)

**Status:** pending approval
**Source spec:** `.omc/specs/deep-interview-project-favorites.md` (ambiguity 16%)
**Mode:** consensus / direct / RALPLAN-DR short
**Revision:** 2 (incorporates Architect SOUND-WITH-CHANGES + Critic REJECT feedback — see Changelog)

---

## Requirements Summary
Add per-user project favorites:
1. Each authenticated user can favorite/unfavorite any **active** project via a star button on each project list row. State is **personal** (per-user), persisted in a new `project_favorites` join table.
2. A **Favorites** tab on the main projects list shows only the current user's favorited projects (within the already-fetched active list). Status/client/search filters still compose inside it.

Favorites are invisible to other users — distinct from the global `archived`/`status` columns on `projects`.

---

## RALPLAN-DR Summary (short)

### Principles
1. **Match real code, not assumed patterns.** Verify the mechanism in the actual file before claiming to "mirror" it. (The archived *view* is a separate paginated endpoint, NOT a client filter — do not mirror it for the favorites view.)
2. **Per-user isolation is non-negotiable.** Favorite state keyed on `(user_id, project_id)`, bound from `requireUser().id` server-side; never from request body; never a `projects` column.
3. **Additive & reversible.** New table + new optional `favorited` field + new endpoint; no change to existing column semantics.
4. **Server is source of truth.** `favorited` computed server-side per request; client never infers cross-user state.
5. **Degrade gracefully.** A missing `project_favorites` table must not 500 the project list (precedent intent: `project_user_hours`, but a favorites-specific mechanism is required — see Step 2).

### Decision Drivers (top 3)
1. **Correct per-user semantics** — the feature is wrong if favorites leak across users.
2. **Minimal blast radius on `listProjects`** — it has 4 SQL branches; the favorited param threads through non-uniformly (pinned below).
3. **UX consistency** — user chose "separate view/tab"; deliver it as a real tab on the existing list (net-new tab state, since none exists today).

### Viable Options

**Option A — Compute `favorited` in `listProjects` via parameterized EXISTS; Favorites tab is a client-side filter over the already-fetched active list.** *(chosen)*
- Pros: Single source of truth; one round trip; star state always accurate; favorites tab needs no new endpoint.
- Cons: `userId` threads through 4 SQL branches at non-uniform param indices; net-new tab state must be added to `ProjectsList`.

**Option B — Separate `GET /projects/favorites` endpoint; main list unchanged.**
- Pros: Smallest `listProjects` change.
- Cons: The per-row star on the **main** list still needs `favorited`, so `listProjects` must join anyway → B saves nothing and adds a second endpoint. Rejected.

**Option C — Client fetches a flat favorite-id list once, intersects in React.**
- Pros: Zero `listProjects` SQL change.
- Cons: Two desyncable sources of truth; extra request; race/ordering complexity. Rejected.

**Why A:** The per-row star forces the `listProjects` join regardless — this kills C's premise and B's savings (verified: `projectListSelectColumns` feeds every list branch, `lib/repositories.ts:406`). Once the join exists, the favorites tab is a free client filter. A = least total code, one source of truth.

---

## Implementation Steps

### 1. DB migration — `supabase/migrations/0032_project_favorites.sql` (new)
- **Precondition:** verified DB backup taken (project rule — memory `feedback_db_backup_before_migration`).
- **Confirm `0032` is unused at implementation time** (repo has historical duplicate numbering, e.g. two `0023_*` files); bump if taken.
- Table:
  ```sql
  create table if not exists project_favorites (
    user_id    text not null references user_profiles(id) on delete cascade,
    project_id uuid not null references projects(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, project_id)
  );
  create index if not exists project_favorites_user_idx on project_favorites(user_id);
  ```
- `user_id text` matches verified existing types: `user_profiles.id text` (`0004_user_profiles.sql:2`), `projects.created_by text` (`0001_init.sql:9`), `project_user_hours.user_id text references user_profiles(id) on delete cascade` (`0009:3`).
- **FK assumption (accepted):** `references user_profiles(id)` gives free cleanup on user deletion and matches `project_user_hours`. Legacy/sentinel ids (`bc2_import`, see `0027`) lack `user_profiles` rows, but favorites are only ever written for live `requireUser` identities, so the FK is safe. Documented as an accepted assumption.
- Composite PK makes favoriting idempotent (no dup rows). Both FKs cascade.
- **Rollback story:** forward-only migration; recovery is restore-from-backup (per project rule). Down-path for local/dev only: `drop table if exists project_favorites;` (include as a commented `-- down` note, not auto-run).

### 2. Repository layer — `lib/repositories.ts`
- Add `userId?: string | null` to `ListProjectsOptions` (type near `lib/repositories.ts:~470`).
- Add `favorited: boolean` to the `ProjectListRow` type (`lib/repositories.ts:~452`).
- **Build the favorited SELECT expression conditionally** (single source, reused by all branches). Define a helper that returns either the EXISTS expression (when favorites are available + `userId` present) or the constant fallback:
  ```ts
  // favoritedExpr(paramIndex) -> e.g. `exists (select 1 from project_favorites pf
  //   where pf.project_id = p.id and pf.user_id = $3) as favorited`
  // fallback -> `false as favorited`
  ```
  Append it to the `projectListSelectColumns` string used per branch. **Never string-interpolate `user_id`** — bind it as a query parameter.
- **Pinned parameter indices** (verified — they are NOT uniform):
  - **FTS search branch** (`repositories.ts:565-575`): current args `[search, clientId]` (`$1`,`$2`). Favorited param = **`$3`**; args become `[search, clientId, userId]`. Note: the favorited param sits in the SELECT clause, which is textually *before* `$1`/`$2`; Postgres numbers by ordinal not position, so `$3` in SELECT is legal — keep the args array order `[search, clientId, userId]`.
  - **Billing branch** (`repositories.ts:588-610`): current args `[clientId]` (`$1`). Favorited = **`$2`**; args `[clientId, userId]`. **Two SQL strings here** (main + the existing `project_user_hours` fallback) — both embed the columns; both need the param.
  - **includeArchived true & false** (`repositories.ts:613-628`): current args `[clientId]` (`$1`). Favorited = **`$2`**; args `[clientId, userId]`. Two separate SQL strings sharing one args array.
- **`countBillingStageProjects` requires NO change** — verified it selects `count(*)::int`, not `projectListSelectColumns` (`repositories.ts:636-661`). Do not touch it.
- **Graceful degradation (favorites-specific, covers ALL branches):** add a new helper `isMissingProjectFavoritesTableError` (regex `/project_favorites/i`, mirroring `isMissingProjectUserHoursTableError` at `repositories.ts:1446-1452`). Preferred mechanism (Architect synthesis): a **one-time table-existence probe** at the top of `listProjects` (e.g. cached `to_regclass('project_favorites') is not null`, or a module-level boolean memoized after first probe). When the table is absent OR `userId` is null/absent, emit `false as favorited` in every branch — avoiding any subselect and avoiding the need to wrap all four branches in try/catch. If a probe is undesirable, the fallback alternative is try/catch + fallback SQL around **all four** branches (the three non-billing branches currently lack try/catch); prefer the probe.
  - **Operational note:** a module-memoized probe caches `false` if the process started before the migration; restart the server after applying `0032` so it begins emitting real `favorited` values.
- New mutation functions:
  ```ts
  export async function addProjectFavorite(userId: string, projectId: string): Promise<void>  // insert ... on conflict (user_id, project_id) do nothing
  export async function removeProjectFavorite(userId: string, projectId: string): Promise<void> // delete where user_id and project_id
  ```

### 3. List API — `app/projects/route.ts`
- GET already calls `await requireUser(request)` (`route.ts:35`) but discards the result. Capture it: `const user = await requireUser(request);` and pass `userId: user.id` into the `listProjects(...)` options object (`route.ts:~70`).

### 4. Favorite mutation endpoint — `app/projects/[id]/favorite/route.ts` (new, hand-written)
- **Do NOT mirror `app/projects/[id]/archive/route.ts`** — that is a factory delegating to `createProjectArchiveRestoreHandler` which performs Dropbox folder moves and uses `notFound`. Write a plain handler.
- Use the Next.js dynamic-params pattern used elsewhere: `export async function POST(request: Request, { params }: { params: Promise<{ id: string }> })`, then `const { id } = await params;`.
- `POST`: `const user = await requireUser(request)` → validate `id` as uuid (`z.string().uuid()`, else `badRequest`) → `await addProjectFavorite(user.id, id)` → `ok({})`.
- `DELETE`: same auth + uuid validation → `await removeProjectFavorite(user.id, id)` → `ok({})`.
- `user.id` comes only from `requireUser`, never the body.

### 5. Client type + optimistic toggle — `components/projects/projects-workspace-context.tsx`
- Add `favorited?: boolean;` to the `Project` type (after `pm_note`; verify exact line, ~`:50`).
- Add a `toggleFavorite(projectId: string, next: boolean)` action **modeled on `moveProject` (`projects-workspace-context.tsx:381-411`)**, not the generic pattern: capture `previousProjects`, optimistically `setProjects` with the row's `favorited = next`, call `authedJsonFetch({ path: \`/projects/${projectId}/favorite\`, init: { method: next ? "POST" : "DELETE" } })`, and on catch `setProjects(previousProjects); throw`. **Skip** the `refreshProjects` round-trip `moveProject` does (favoriting does not change active membership).
- **Concurrency:** the star button must be disabled while a toggle for that project is in-flight (prevents a POST/DELETE race from a rapid double-click). Track in-flight project ids locally.

### 6. List row star button — `components/projects/projects-list-view.tsx`
- The row (`projects-list-view.tsx:~155-211`) navigates via a `<Link href={\`/${project.id}\`}>` (`:166-167`) and keyboard `Enter` on the highlighted row (handled in `projects-list.tsx:105-107`). The `<li>` has **no** `onClick`.
- Render a star `<button type="button">` as a **sibling of the `<Link>`, NOT nested inside it** (so a click never triggers `<Link>` navigation — this is the real isolation requirement, not `stopPropagation` on a nonexistent row handler).
- Filled icon when `project.favorited`, outline otherwise. Wire `onClick` → `toggleFavorite(project.id, !project.favorited)`; disabled while in-flight.
- a11y: `aria-label` ("Favorite project" / "Unfavorite project"), `aria-pressed={!!project.favorited}`.
- Verify the new button does not disturb the row's `onFocusCapture`/`onBlurCapture` highlight handling (`:161-162`) — it lives inside the same `<li>`, so confirm focusing the star does not clear/!change `highlightedProjectId` incorrectly.

### 7. Favorites tab — `components/projects/projects-list.tsx`
- **There is no existing tab mechanism to "extend."** `ProjectsList` hard-codes `activeTab="list"` as a literal prop (`projects-list.tsx:164`); `activeTab` is only a presentational prop on `ProjectsListView` typed `"list" | "archived"` (`projects-list-view.tsx:48`) controlling empty-state copy. The archived view is a separate route. This step adds net-new state.
- Introduce `const [activeTab, setActiveTab] = useState<"all" | "favorites">("all")` in `ProjectsList` (near the existing `statusFilter` state, `:37`).
- Add a small tab control (All | Favorites) in the workbench header area.
- Derive visible projects from the **existing `filteredActiveProjects` pipeline** (which already applies status/client/search), THEN apply favorites:
  ```ts
  const visibleProjects = activeTab === "favorites"
    ? filteredActiveProjects.filter((p) => p.favorited)
    : filteredActiveProjects;
  ```
  Do **not** filter raw `activeProjects` (that would bypass status/client/search composition the acceptance criteria require).
- Re-point the derived memos to `visibleProjects`: `keyboardNavigableProjects` (`:43-49`), `statusSummaries` (`:51-62`), and the empty-state — so keyboard nav, counts, and empty-state reflect the favorites filter.
- Empty-state copy (desktop wording): "No favorites yet — click the star on a project to add it."

### 8. Styling
- Reuse existing ledger/`tone-*` classes; add a `projectFavoriteStar` class (filled/outline + disabled states) in the stylesheet the row classes live in. No new UI lib.

### Favorited + archived interaction (resolved decision)
- **Decision: out of scope this iteration.** The Favorites tab filters the active (non-archived) list only (`activeProjects = projects.filter(p => !p.archived)`, `projects-workspace-context.tsx:213`; the workspace always fetches `includeArchived=false`, `:123`). A favorited project that is later archived will not appear in the Favorites tab; its `project_favorites` row persists (and reappears if restored). Recorded as a **Non-Goal** and an explicit acceptance criterion below.

---

## Non-Goals
- No shared/global favorite flag visible to all users.
- No sort-to-top / pinning.
- No favorite button on the project detail page.
- **No surfacing of favorited-but-archived projects** in the Favorites tab this iteration (the favorite row is retained; only the view excludes archived).
- No favorite button in the separate archived route's rows.

---

## Acceptance Criteria (testable)
- [ ] `project_favorites` exists: composite PK `(user_id, project_id)`, FK `user_id → user_profiles(id) on delete cascade`, FK `project_id → projects(id) on delete cascade`, index on `user_id`.
- [ ] `POST /projects/:id/favorite` inserts a row for the authed user; a repeat POST is idempotent (no error, no dup row).
- [ ] `DELETE /projects/:id/favorite` removes only that user's row for that project.
- [ ] `POST`/`DELETE` with a non-uuid `:id` returns `badRequest`.
- [ ] `GET /projects` returns `favorited: true` only for projects the **authed** user favorited; a second user gets `favorited: false` for the same project (per-user isolation).
- [ ] Existing list behavior is unchanged: FTS search branch, billing list, includeArchived true/false, status filter, and sort all return the same rows/order as before (regression).
- [ ] When `project_favorites` is absent (pre-migration), `GET /projects` returns 200 with `favorited: false` for all rows (no 500).
- [ ] Clicking the row star toggles favorite state and it persists across reload.
- [ ] The star button is a sibling of the row `<Link>` and clicking it does NOT navigate to the project.
- [ ] The star is disabled while a toggle is in-flight (no POST/DELETE race on rapid clicks).
- [ ] The Favorites tab shows exactly the current user's favorited active projects; status/client/search filters still apply within it (verified by filtering inside the favorites tab).
- [ ] A favorited project that is archived does NOT appear in the Favorites tab, and its favorite row still exists in the DB (documented behavior).
- [ ] Star button exposes `aria-pressed` and a descriptive `aria-label`.
- [ ] Deleting a project removes its `project_favorites` rows (cascade).

## Risks and Mitigations
| Risk | Mitigation |
|------|-----------|
| Favorited param misindexed across the 4 branches | Indices pinned in Step 2 ($3 FTS, $2 elsewhere); unit test asserts per-user `favorited` AND that search/billing/archived rows are unchanged. |
| Missing `project_favorites` table 500s the list | One-time existence probe → `false as favorited` in all branches; acceptance criterion + unit test with table absent. |
| Star click navigates to project | Button is a sibling of `<Link>`, `type="button"`; unit test asserts click does not change `window.location`. |
| Rapid toggle POST/DELETE race | Disable star while in-flight; optimistic rollback mirrors `moveProject`. |
| `user_id` type mismatch vs auth id | Verified `text` across `user_profiles`/`projects`/`project_user_hours`; FK enforces referential integrity. |
| Migration run without backup | Hard gate: confirm verified DB backup before running `0032`. |
| `0032` number already used | Confirm unused at implementation time; bump if taken. |

## Verification Steps
*(Test harness: the repo uses **vitest** (`package.json` `test: vitest run`). There is no Playwright/e2e — all automated checks are vitest unit/integration; reload/visual checks are manual QA.)*

**Automated (vitest):**
1. `tests/unit/project-favorite-route.test.ts` (new, modeled on the existing `tests/unit/project-archive-route.test.ts`): POST inserts + is idempotent; DELETE removes; non-uuid → `badRequest`; unauthenticated → unauthorized.
2. `tests/unit` repository test: `listProjects({ userId: A })` returns `favorited:true` for A's favorite and `favorited:false` for user B; **the FTS search branch returns rows (asserts the `$3`-in-SELECT param indexing does not error)** and billing branch still returns expected rows with the param threaded.
3. Repository test with `project_favorites` absent → `favorited:false`, no throw. Drive this through the **real probe path** against a DB/schema without the table (so `to_regclass(...) is null`), not by mocking the helper — otherwise it degrades to a manual-only check.
4. Component test: clicking the star calls `toggleFavorite` and does not change `window.location`; star disabled while in-flight; Favorites tab filters to favorited rows while preserving an active status/search filter.

**Manual QA:**
5. `pnpm lint` + `pnpm build` clean.
6. Apply `0032` to a backed-up test DB; confirm table, FKs, index.
7. UI: star toggles and persists on reload; Favorites tab + status/search compose; archived/billing views unaffected; archived-favorite disappears from Favorites tab (documented).

---

## ADR
- **Decision:** Per-user favorites via a `project_favorites(user_id, project_id)` join table; `favorited` computed in `listProjects` via a parameterized EXISTS (with a table-existence probe fallback to `false`); Favorites tab is a client-side filter over `filteredActiveProjects`; toggle via a new hand-written `POST/DELETE /projects/:id/favorite`.
- **Drivers:** correct per-user isolation; minimal/controlled blast radius on the 4-branch `listProjects`; deliver the user-chosen tab UX.
- **Alternatives considered:** (B) separate favorites endpoint — rejected, main-list star forces the join so it saves nothing; (C) client-side id-set intersection — rejected, two desyncable sources of truth; (B′) denormalized `favorited_by text[]` on `projects` — rejected, violates the per-user-not-a-column constraint and adds write contention with `moveProject` status writes.
- **Why chosen:** the per-row star makes the `listProjects` join unavoidable; once present, the favorites view is free as a client filter → least code, single source of truth, spec-compliant.
- **Consequences:** each list row carries one EXISTS subselect (indexed on `project_favorites.user_id`; list capped at 100 rows, `repositories.ts:573`); `listProjects` options gain optional `userId`; `GET /projects` must authenticate (it already does); favorited-but-archived is intentionally excluded from the tab this iteration.
- **Follow-ups:** optional sort-to-top (non-goal now); optional detail-page favorite button (deferred); optional surfacing of archived favorites.

---

## Changelog (Revision 2 — applied reviewer feedback)
- **[Critic CRITICAL]** Resolved favorited+archived behavior: documented Non-Goal + acceptance criterion (favorites tab = active list only).
- **[Critic CRITICAL]** Rewrote Step 7: there is no existing tab mechanism; added net-new `activeTab` state, tab control, and re-pointed `keyboardNavigableProjects`/`statusSummaries`/empty-state through `filteredActiveProjects`-derived `visibleProjects`.
- **[Architect+Critic]** Pinned exact per-branch param indices ($3 FTS, $2 billing/includeArchived); noted SELECT-clause param ordering.
- **[Architect+Critic]** Replaced the `isMissingProjectUserHoursTableError` reuse with a favorites-specific probe/helper covering all 4 branches.
- **[Architect+Critic]** Stated `countBillingStageProjects` needs no change (does not use `projectListSelectColumns`).
- **[Critic MAJOR]** Removed fictional "e2e" coverage; verification now names concrete vitest files and separates automated vs manual.
- **[Critic MAJOR]** Corrected the star isolation mechanism: sibling-of-`<Link>` + `type="button"` (not `stopPropagation` on a nonexistent row handler); added focus-capture caution.
- **[Critic MAJOR]** Stopped "mirror archive route" for the mutation endpoint (factory does Dropbox work); specified a hand-written handler with the `params: Promise<{id}>` unwrap.
- **[Architect+Critic]** `toggleFavorite` now explicitly models `moveProject` (optimistic + rollback, skip `refreshProjects`); added in-flight disable for concurrency.
- **[Architect]** Added FK `user_id → user_profiles(id) on delete cascade` with documented legacy-sentinel-id assumption.
- **[Critic minor]** Migration: confirm `0032` unused (historical dup numbering); added rollback note. Empty-state copy changed "tap" → "click" (desktop).
- **[Critic APPROVE-WITH-NITS, applied]** Added FTS `$3`-in-SELECT explicit test assertion; dropped "if present" on the archive-route test (it exists); added probe-cache restart operational note; clarified the missing-table test must drive the real probe path (not a mock).

## Consensus Result
- Architect: **SOUND-WITH-CHANGES** (Option A correct; required changes merged in Rev 2).
- Critic: iteration 1 **REJECT** → Rev 2 **APPROVE-WITH-NITS**, no blocking items; all 4 nits applied.
- Status: **pending approval** — no execution started. Awaiting explicit user approval to implement (via team/ralph or direct).
