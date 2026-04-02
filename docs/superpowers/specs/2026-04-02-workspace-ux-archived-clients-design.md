# Workspace UX, billing badge, discussion headings, financial rollup, and archived clients

**Date:** 2026-04-02  
**Status:** Draft (ready for review)  
**Type:** Feature bundle — projects workspace, project detail, clients, Dropbox

---

## Summary

This spec bundles several UX and data behaviors agreed in brainstorm (2026-04-02):

1. **Projects hero** — Show only on the main **Projects** surfaces; **defer** feed loading so the workspace is not blocked on `/feeds/latest`; **no** build-time article cache in v1.
2. **Billing nav** — Badge on **Billing** showing the **raw** count of projects in the billing stage.
3. **Discussion page** — Document outline: **`<h1>`** = project name, **`<h2>`** = discussion title (one H1 per page).
4. **Financial rollup** (project detail) — **Hours** section shows **hours only** (no per-row rate/USD math, no hours USD subtotal). **Grand total** = **expense lines subtotal only** (not hours + expenses).
5. **Archived clients** — Clients can be **archived**; Dropbox folder moves from `DROPBOX_PROJECTS_ROOT_FOLDER` hierarchy to `DROPBOX_ARCHIVED_CLIENTS_ROOT`. While archived, **no new** projects, discussions, comments, or file uploads for that client’s projects.

**Explicitly out of v1 / already handled**

- **Comment form polish** — Completed by the product owner; no spec requirements here.
- **Build-time feed cache** — Deferred; may be a later performance pass.

---

## Resolved decisions

| Topic | Decision |
|-------|----------|
| Hero feed performance (v1) | **Split + defer**: hero/feed loads independently; do **not** block project list bootstrap on feed fetch. |
| Build-time article cache | **Not** in this release. |
| Billing tab badge | **Raw** count (no `9+` cap). |
| Archived client: mutations | **Hard lock**: no new **projects**, **discussions**, **comments**, or **files** while client is archived. Restore requires **un-archive** (or equivalent) first. |
| Dropbox archived root | **`DROPBOX_ARCHIVED_CLIENTS_ROOT`** — env already added to `.env.example` / `.env.local` (user-configured path under the team space). |
| Archive / restore **status UX** | **HTTP polling only** — **2 s** interval while move is non-terminal; **no** SSE or Supabase Realtime for this feature in v1 (see § Locked transport). **Confirmed by product:** polling over Realtime (2026-04-02). |

---

## 1. Projects hero visibility and feed loading

### Problem

`ProjectsWorkspaceShell` always renders the hero + feed rail. **Billing** and **Archive** pages use the same shell, so they show the full marketing-style hero unnecessarily.

### Goal

- Hero + feed rail appear **only** on **Projects** views (home project list/board, e.g. `/` and `/flow`).
- **Billing** (`/billing`) and **Archive** (`/archive`): **no** hero — use a compact layout or top-level title only (match existing archive/billing styling patterns).

### Behavior

- Add a shell prop or variant, e.g. `showHero?: boolean` (default `true` for backward compatibility) or `layout: "projects" \| "minimal"`.
- `projects-billing.tsx` and `projects-archive.tsx` pass **minimal** / `showHero={false}`.
- List/board entry points keep **default** hero.

### Performance (v1)

- **Today:** `loadProjectsBootstrap()` in `projects-workspace-context.tsx` fetches `/feeds/latest` before session/projects load.
- **Change:** Move feed fetch **out of** the critical path for workspace data:
  - Option A: Lazy-load featured posts in a child component after mount (or `requestIdleCallback` / `startTransition`).
  - Option B: Parallelize feed + auth + projects (do not `await` feed before projects) and let hero show placeholder until feed resolves.
- **Non-goal:** Generating a static JSON artifact at build time — **deferred**.

### Acceptance

- Billing and archive pages do not render `projectsHero` / feed rail markup.
- Projects index load is not gated on feed completion (measure: projects visible when feed is slow or fails).

---

## 2. Billing tab notification badge

### Problem

Users cannot see at a glance how many jobs are waiting in billing.

### Goal

Header link to **Billing** shows a **numeric badge** = count of projects in **billing** status (same definition as the Billing page list).

### Behavior

- **Raw count** — display `0`, `1`, `12`, etc.; no truncation.
- Count must match the Billing page query (single source of truth — shared API filter or lightweight `GET` that returns `{ count }` only).
- Badge may be hidden when count is `0` (recommended) or show `0` — **prefer hidden when zero** for cleaner chrome; document in implementation if product prefers always-visible.

### Acceptance

- Count updates when navigating back from billing after state changes (invalidate or refetch strategy).

---

## 3. Discussion page headings

### Problem

Semantic / SEO / accessibility: project context and discussion title hierarchy should be explicit.

### Goal

On `app/[id]/[discussion]/page.tsx` (and any shared layout for a single discussion):

- **`<h1>`** — Project display name (link to project root optional but recommended).
- **`<h2>`** — Discussion thread title.

### Constraints

- Exactly **one** `<h1>` per page.
- Existing visual styles may need CSS tweaks so headings don’t look oversized; preserve current density where possible.

---

## 4. Financial rollup (project detail)

### Problem

The rollup mixes **hours × rate** USD with **expense lines**. Product wants **grand total** to reflect **expenses only**; hours remain **informational** in hours, not dollars.

### Goal

- **Hours card:**  
  - Rows: person, **hours** only (remove per-row `/hr` and line USD).  
  - Remove **Hours subtotal** in **USD**; optional **total hours** figure if useful.  
- **Expense card:** Unchanged behavior for lines and **Expense subtotal** (USD).  
- **Grand total:** **Equal to expense subtotal** (rename label if needed, e.g. “Total (expenses)” vs “Grand total” — align copy in implementation).

### Implementation notes

- Update helpers in `lib/project-financials` (or equivalent) so `grandTotalUsd` (or successor) **does not** include hours-derived USD.
- Remove or stop using `calculateProjectGrandTotalUsd` combining hours + expenses if the product rule is strict.
- **Global hourly rate** in settings may remain for future use; hide from this section if it becomes misleading (optional follow-up).

### Acceptance

- No USD amount in the hours section except if explicitly reintroduced later by spec.
- Grand total matches sum of expense lines only.

---

## 5. Archived clients (database, Dropbox, enforcement)

### Problem

Clients need a lifecycle: **active** vs **archived**. Archiving should **move** the client’s folder tree in Dropbox from the active **projects** root to a dedicated **archived** root, and **freeze** all mutating activity for that client’s work.

### Environment

| Variable | Purpose |
|----------|---------|
| `DROPBOX_PROJECTS_ROOT_FOLDER` | Existing active projects / client folder root (already in use). |
| `DROPBOX_ARCHIVED_CLIENTS_ROOT` | Destination root for archived client folders (user-added; e.g. `"/Projects Archive"`). |

Both must be validated when performing a move (non-empty, normalize paths per existing Dropbox helpers).

### Data model

- Add **`clients.archived_at`** `timestamptz` **null** (null = active) **or** `boolean archived` — **prefer `archived_at`** for audit and “when was this archived.”
- **Archive lifecycle (recommended):** Large client folders (design sources, many projects) make a naïve “await Dropbox in one HTTP request” risky: **gateway timeouts**, **function max duration**, and **blocked UI** while the move runs. Prefer explicit state beyond a single timestamp:
  - **`clients.dropbox_archive_status`** `text` (or enum) — e.g. `idle` \| `pending` \| `in_progress` \| `completed` \| `failed` (exact names TBD in implementation), **or**
  - **`clients.archived_at`** set only when **both** DB rules and Dropbox move are satisfied, plus **`clients.archive_started_at`** / **`archive_error`** for in-flight and failure.
- Migration + RLS: follow existing `clients` policies; archived clients still **readable** for historical projects (list filters may hide by default).

### Dropbox behavior

- On **archive**: move the **client** folder tree from under the active projects root to under `DROPBOX_ARCHIVED_CLIENTS_ROOT`, preserving folder naming conventions used at client creation (document exact path join in implementation). Implementation today uses **`files/move_v2`** (`moveProjectFolder` in `lib/storage/dropbox-adapter.ts`) — **one API call** for the whole tree, but **response latency grows** with tree size and Dropbox load; treat as **possibly long-running** from the app’s perspective.
- On **un-archive**: reverse move back under active root (must fail clearly if path collision or Dropbox error).
- **Duration and timeouts (resolved concern):**
  - **Do not** rely on a single synchronous request that must complete before the user gets any response, if folders can be **very large** — risk of **504 / function timeout** and poor UX.
  - **Preferred v1 pattern:** **Two-phase flow**
    1. User confirms archive → persist **`pending` / `in_progress`** (and optionally set **`archived_at` only after success** — see enforcement below).
    2. Run the Dropbox move in a context that tolerates long work: **background job** (queue/cron), **`waitUntil`** / async continuation on Vercel Fluid Compute, or **dedicated long-timeout route** — exact mechanism follows platform limits (document in implementation plan).
    3. On success: set **`completed`**, set **`archived_at`**, refresh any stored **Dropbox paths** for projects/files under that client if the app keeps absolute paths (path rewrite or re-query metadata — **must** be specified when implementing).
    4. On failure: **`failed`**, surface error, allow **retry**; do **not** leave “half archived” without operator visibility.
  - **Simpler fallback (small workspaces only):** synchronous move in the request if product accepts **max folder size** or ops confirms moves finish under **P95** function time; still return **202 + poll** if approaching limits.
- Idempotency and partial failures: if DB marks archived but Dropbox fails (or inverse), define **reconcilable error** state and **manual retry** — avoid silent drift between DB and Dropbox.

### Enforcement during in-progress archive

- While **`dropbox_archive_status`** is **`pending` or `in_progress`** (or equivalent), apply the **same mutation blocks** as for fully archived clients: **no new** projects, discussions, comments, or uploads — prevents new content being written under paths that are mid-move.
- **Reads** may stay allowed **only if** paths in DB still resolve during move (if not, show “Archive in progress” and read-only messaging — product may tighten this in implementation once path behavior is clear).

### API / UI

- **Settings or clients table UI:** **Archive client** / **Restore client** actions (confirm destructive-sounding archive).
- List views: filter archived clients from pickers (create project, etc.).

### UX during Dropbox transfer (required)

The user must **see ongoing feedback** for the whole time the **folder move** (archive or restore) may take — not only a success toast at the end. Dropbox **`move_v2`** does not expose per-file or byte-level progress; the UI should still **update continuously** in a way that feels responsive.

| Requirement | Detail |
|-------------|--------|
| **Visible state** | After the user confirms, the UI enters a dedicated **“transfer in progress”** state for **that client** (not a silent background action). |
| **Updates while waiting** | **HTTP polling** — normative rules in **§ Locked transport** below. **Do not** use SSE or Supabase Realtime for archive status in v1. |
| **Indeterminate progress** | Show a **spinner or progress bar in indeterminate mode** plus **status text** that changes at least when phase changes: e.g. Queued → Moving folder in Dropbox → Finalizing. If only one Dropbox phase exists, still **pulse / animate** and show **elapsed time** or **last updated** so the screen does not look frozen. |
| **Copy** | Explain that **large design files can take several minutes**; avoid implying an instant operation. |
| **Persistence** | If the user **navigates away**, returning to **Settings / clients** (or wherever archive was started) must still show **Archiving…** / **Restoring…** for that row until terminal. Optional: **toast** when complete if they navigated away. |
| **Failure** | Clear **inline error** on the client row + **Retry** (re-invokes move) without duplicating work when safe (idempotent retry). |
| **Un-archive** | Same UX pattern when moving back to the active root. |

#### Locked transport — HTTP polling (normative)

**Product decision:** **Polling** is the chosen transport for archive/restore status (confirmed 2026-04-02). Supabase Realtime is **out of scope** for this feature unless the spec is revised.

- **Mechanism:** The browser (or client) **polls** an authenticated **GET** that includes `dropbox_archive_status` (or equivalent), `archived_at`, and `archive_error` / phase fields for the affected **client** — e.g. `GET /clients` (if the list payload includes those columns) or **`GET /clients/:id`** if a single-client endpoint is added.
- **Interval:** **2 seconds** between requests while status is **non-terminal** (`pending`, `in_progress`, or any state that is not `completed`, `failed`, or `idle` after a terminal outcome — exact enum in implementation).
- **Stop condition:** Stop polling when the move reaches a **terminal** state (`completed` or `failed`), the user leaves the page **and** there is no in-flight transfer (optional: keep a single global poll only if product requires cross-tab sync; default: poll only on the clients/settings view where archive was started).
- **Backoff:** Optional: increase interval to **5 s** after **2 minutes** elapsed to reduce load; not required for v1.
- **Rationale:** Fits existing `authedFetch` / route handlers; no Realtime publication or extra RLS tuning for this feature. Status changes during a Dropbox move are **low frequency**, so up to ~2 s staleness is acceptable.

#### Polling vs Supabase Realtime (reference — not in scope for v1)

| | **HTTP polling (chosen)** | **Supabase Realtime** |
|--|---------------------------|-------------------------|
| **Update path** | Repeated **GET** on an interval | **Push** on row `UPDATE` after commit |
| **Typical latency** | Up to ~one interval (e.g. 2 s) after DB change | Usually sub-second |
| **Load** | Steady read QPS while watching | Long-lived connection; few HTTP reads |
| **Implementation** | Same as rest of app | Browser Supabase client, table in Realtime publication, RLS, subscribe lifecycle |
| **When to reconsider** | If many users/tabs poll heavily, or UX needs instant updates | Future revision only |

### Enforcement (server-side required)

Reject with **4xx** and clear message when `client.archived_at IS NOT NULL` (or equivalent) for:

| Operation | Scope |
|-----------|--------|
| Create project | `POST /projects` (or equivalent) |
| Create discussion | Project routes creating threads |
| Post comment | Comment create APIs |
| Upload / complete upload | File upload initiation and completion |

**Read** paths (view project, read discussions, download existing files) remain allowed unless product says otherwise — **default: read-only OK**.

### Acceptance

- Cannot create project for archived client via API or UI.
- Cannot add discussion, comment, or file for projects under archived client **or** while that client’s archive move is **pending / in progress** (see § Enforcement during in-progress archive).
- Archive UX does not assume the Dropbox move finishes inside a single short HTTP request; the user sees **live-updating status** for the full transfer via **§ Locked transport — HTTP polling** (2 s interval, stop at terminal), plus indeterminate progress + copy, survives navigation, failure + retry.
- When complete, Dropbox folder for that client lives under configured archived root; stored paths remain consistent or are explicitly updated.

---

## Non-goals (this release)

- Build-time static feed JSON for hero.
- Invoicing or changing expense line schema.
- Archiving **projects** (already exists) — this spec is **clients** only.
- Comment composer UI changes (owner completed).

---

## Testing expectations

- Unit: financial rollup helpers (grand total = expenses only; hours totals).
- Unit or integration: API rejects mutations for archived client (representative routes).
- Repository filter: billing count for header badge matches billing list.
- Optional: Dropbox adapter move/rename mocked in tests for archive/un-archive.
- UI: client row reflects **in-progress** and **terminal** states under **2 s polling** (component test with mocked API sequence advancing status).

---

## Related files (implementation hints)

- `components/projects/projects-workspace-shell.tsx` — hero visibility.
- `components/projects/projects-workspace-context.tsx` — bootstrap / feed loading order.
- `components/projects/projects-billing.tsx`, `projects-archive.tsx` — shell props.
- `app/header.tsx` — billing badge.
- `app/[id]/[discussion]/page.tsx` — H1/H2.
- `app/[id]/page.tsx` — financial rollup UI + helpers.
- `lib/project-financials.ts` (or current financial helpers) — totals.
- `supabase/migrations/*` — `clients.archived_at` (or similar).
- `lib/repositories.ts`, `app/projects/route.ts`, discussion/comment/file routes — enforcement checks.
- `lib/storage/dropbox-adapter.ts` — folder move.

---

## Open questions

| Topic | Question |
|-------|----------|
| Background execution | Confirm platform choice for long moves: **Vercel `waitUntil` + Fluid**, **queued job + cron**, or **manual “retry move”** only — pick in implementation plan. |
| Path updates | After `move_v2`, batch-update `dropbox_path` / project dir columns vs lazy refresh — depends on how many rows reference absolute paths today. |

---

## Revision history

| Date | Author | Notes |
|------|--------|-------|
| 2026-04-02 | Spec from brainstorm | Initial draft |
| 2026-04-02 | Review | Added Dropbox **large-folder / long move** concern: two-phase archive, status fields, mutation lock during move, timeout risk. |
| 2026-04-02 | Review | Required **UX during transfer**: polling/push, indeterminate progress, copy, persistence across navigation, failure + retry; same for un-archive. |
| 2026-04-02 | Review | **Locked transport:** HTTP polling **2 s** for archive status; SSE/Realtime out of scope for this feature unless spec revised. |
| 2026-04-02 | Product | **Confirmed polling** over Realtime; fixed broken table; added comparison table (reference). |
