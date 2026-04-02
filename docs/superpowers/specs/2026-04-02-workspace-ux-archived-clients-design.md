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
- Migration + RLS: follow existing `clients` policies; archived clients still **readable** for historical projects (list filters may hide by default).

### Dropbox behavior

- On **archive**: move the client’s folder from under the active projects root to under `DROPBOX_ARCHIVED_CLIENTS_ROOT`, preserving folder naming conventions used at client creation (document exact path join in implementation).
- On **un-archive**: reverse move back under active root (must fail clearly if path collision or Dropbox error).
- Idempotency and partial failures: if DB update succeeds but Dropbox fails, define **rollback** or **reconcilable error** state (avoid orphaned DB “archived” without moved folder).

### API / UI

- **Settings or clients table UI:** **Archive client** / **Restore client** actions (confirm destructive-sounding archive).
- List views: filter archived clients from pickers (create project, etc.).

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
- Cannot add discussion, comment, or file for projects under archived client.
- Dropbox folder path after archive lives under configured archived root.

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

_None — superseded by 2026-04-02 brainstorm and user confirmations._

---

## Revision history

| Date | Author | Notes |
|------|--------|-------|
| 2026-04-02 | Spec from brainstorm | Initial draft |
