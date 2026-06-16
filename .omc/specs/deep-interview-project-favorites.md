# Deep Interview Spec: Per-User Project Favorites + Favorites View

## Metadata
- Interview ID: project-favorites
- Rounds: 3
- Final Ambiguity Score: 16%
- Type: brownfield
- Generated: 2026-06-16
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.92 | 0.35 | 0.322 |
| Constraint Clarity | 0.80 | 0.25 | 0.200 |
| Success Criteria | 0.82 | 0.25 | 0.205 |
| Context Clarity | 0.78 | 0.15 | 0.117 |
| **Total Clarity** | | | **0.844** |
| **Ambiguity** | | | **0.156** |

## Topology
| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| Favorite toggle | active | Mark/unmark a project as a personal favorite | Star icon on each list row; persisted per-user |
| Favorites filter | active | View only favorited projects | Separate view/tab, mirrors archived-view pattern |

## Goal
Let each authenticated user mark any project as a **personal** favorite via a star icon on each project list row, and view a separate "Favorites" view showing only the projects that user has favorited. Favorites are per-user and invisible to other users — unlike the existing global `archived`/`status` flags.

## Constraints
- **Per-user, not global.** Favorite state belongs to (user, project), NOT a column on `projects`. New join table required.
- Favorites view is a **separate view/tab** (like `components/projects/projects-archive.tsx`), not an inline AND-filter on the main list.
- Star toggle lives on **each list row** in the main projects list, toggles instantly.
- Must coexist with existing list filters (status, client, search, archived) without breaking them.
- Flat auth model — no per-project membership; any authed user can favorite any project for themselves. (See project memory: no-per-project-membership.)
- DB backup required before running the new migration (project rule).

## Non-Goals
- No shared/global favorite flag visible to all users.
- No sort-to-top / pinning behavior (explicitly not chosen; favorites is a filter/view, not a sort).
- No favorite button on the project detail page in this iteration (row star only).
- No favorites count, sharing, or notifications.

## Acceptance Criteria
- [ ] A `project_favorites` table exists keyed on `(user_id, project_id)` with a uniqueness constraint and FK/cascade on project delete.
- [ ] Clicking the star on a project row favorites it; clicking again unfavorites it; state persists across reload.
- [ ] Favorite state is per-user: user A favoriting a project does not change what user B sees.
- [ ] A "Favorites" view/tab shows only the current user's favorited projects.
- [ ] Star indicator reflects current favorite state on each row in both the main list and favorites view.
- [ ] Existing status/client/search/archived filters continue to work unchanged.
- [ ] Toggle and view both resolve the current user via the existing `requireUser(request)` / `user.id` pattern.

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| Favorite is a project column like archived | Is it personal or shared? | Personal (per-user) → join table |
| Filter ANDs into existing list | How does it combine with status/client filters? | Separate view/tab instead |
| Toggle on detail page | Where does the user click? | Star icon on each list row |
| Favorites should pin to top | Filter vs sort? | Filter/view only; no pinning (non-goal) |

## Technical Context (brownfield)
- **DB:** Supabase Postgres, SQL migrations in `supabase/migrations/`. Latest is 0031; add next migration for `project_favorites`.
- **Project type:** `components/projects/projects-workspace-context.tsx:31-50` — add an `is_favorite`/`favorited` boolean derived per-request (computed via join against current user), NOT a stored project column.
- **List fetch:** `lib/repositories.ts:555-629` `listProjects(includeArchived, options)`; select columns at `repositories.ts:406` (`projectListSelectColumns`). LEFT JOIN `project_favorites` on `user_id = currentUser` to expose `favorited`. Pass user id into options.
- **List API:** `app/projects/route.ts:33-80` (`GET /projects`) — add a `favoritesOnly` query param for the favorites view; thread `user.id`.
- **Mutation pattern:** new endpoint, e.g. `POST/DELETE app/projects/[id]/favorite/route.ts`, mirroring `app/projects/[id]/archive/route.ts` factory pattern. Resolve user via `requireUser(request)`.
- **List UI:** `components/projects/projects-list.tsx` (filter state ~line 30, keyboard nav 80-102) and row rendering in `components/projects/projects-list-view.tsx:60-127`. Favorites view mirrors `components/projects/projects-archive.tsx`.
- **Styling:** custom Tailwind-like classes (`projectLedgerItem`, `tone-*`), `OneShotButton` for action buttons. No external UI lib.
- **Auth:** `lib/auth.ts` `requireUser` → `{ id, email }`; client fetch via `authedJsonFetch`.

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| User | core domain | id (uuid), email | User favorites many Projects |
| Project | core domain | id, name, slug, status, archived, tags | Project favorited by many Users |
| Favorite | core domain (join) | user_id, project_id, created_at | links User ↔ Project |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 3 | 3 | - | - | N/A |
| 2 | 3 | 0 | 0 | 3 | 100% |
| 3 | 3 | 0 | 0 | 3 | 100% |

## Interview Transcript
<details>
<summary>Full Q&A (3 rounds)</summary>

### Round 0 — Topology
**Q:** Two components: (1) favorite toggle, (2) favorites filter — right?
**A:** Yes, both — toggle + filter.

### Round 1
**Q:** Is a favorite personal (per-user) or shared (global flag like archived/status)?
**A:** Personal (per-user).
**Ambiguity:** 36% (Goal 0.85, Constraints 0.45, Criteria 0.50, Context 0.70)

### Round 2
**Q:** How does the favorites filter behave alongside existing status/client/search filters?
**A:** Separate view/tab (like the archived view).
**Ambiguity:** 29% (Goal 0.85, Constraints 0.72, Criteria 0.50, Context 0.72)

### Round 3
**Q:** Where does the favorite toggle live and what's the affordance?
**A:** Star icon on each list row.
**Ambiguity:** 16% (Goal 0.92, Constraints 0.80, Criteria 0.82, Context 0.78)

</details>
