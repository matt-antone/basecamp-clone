# Workspace UX, billing badge, discussion headings, financial rollup, archived clients — multi-agent implementation plan

**Track 0 notes:** See [2026-04-02-track0-notes.md](../handoffs/2026-04-02-track0-notes.md) (Dropbox path storage + `waitUntil` / 202 / poll pattern for Track 5).

**Status:** **Draft** — ready to execute when orchestrator assigns sub-agents.  
**Spec:** [2026-04-02-workspace-ux-archived-clients-design.md](../specs/2026-04-02-workspace-ux-archived-clients-design.md)

**Orchestration:** Run **one sub-agent task at a time** per `AGENTS.md`. Parallelize independent tracks only after explicit handoff notes exist (shared types, migration applied locally). Each numbered task block should fit one sub-agent turn without exceeding ~50% context.

---

## Goal

Deliver the bundled behaviors in the spec: **projects hero scope + deferred feed**, **billing nav badge**, **discussion H1/H2**, **financial rollup (expenses-only grand total)**, and **archived clients** (DB, Dropbox, enforcement, HTTP polling UX).

---

## Track 0 — Spike (1 agent)

Close open questions from the spec so implementation agents do not thrash.

| Task | Output |
|------|--------|
| **0a — Path inventory** | Short note: where `dropbox_path` / project dir / file paths are stored and read; recommend **batch update vs lazy refresh** after `move_v2` with one chosen default. |
| **0b — Background mechanism** | Pick v1 approach: e.g. **`waitUntil` + async continuation** on archive POST returning **202** + poll URL, vs **dedicated long-timeout route** only if P95 fits; document **max duration** and **retry** behavior. |

**Handoff:** Implementation notes (PR description or short doc) with: enum values for `dropbox_archive_status`, chosen background pattern, path strategy.

---

## Track 1 — Projects workspace (§1)

| Task | Description |
|------|-------------|
| **1.1** | Add `showHero` or `layout: "projects" \| "minimal"` to `ProjectsWorkspaceShell`; default preserves current behavior. |
| **1.2** | Wire **Billing** and **Archive** pages to **minimal** / `showHero={false}`. |
| **1.3** | Refactor bootstrap: **do not await** `/feeds/latest` before projects/session; lazy child, `startTransition`, or parallel fetch + placeholder (spec Option A/B). |

**Files:** `components/projects/projects-workspace-shell.tsx`, `projects-workspace-context.tsx`, `projects-billing.tsx`, `projects-archive.tsx`

**Acceptance:** Billing/Archive have no hero/feed rail; projects list usable when feed is slow or fails.

---

## Track 2 — Billing badge (§2)

| Task | Description |
|------|-------------|
| **2.1** | Extract **billing-stage project count** into one function used by Billing page list and header. |
| **2.2** | Lightweight `GET` returning `{ count }` **or** shared server helper + refetch/invalidate so count matches list. |
| **2.3** | `app/header.tsx`: badge (**hidden at 0** per spec); refetch on navigation as needed. |

**Acceptance:** Count matches Billing list; updates after returning from billing when state changes.

---

## Track 3 — Discussion headings (§3)

| Task | Description |
|------|-------------|
| **3.1** | `app/[id]/[discussion]/page.tsx`: **`<h1>`** = project display name (optional link to project root); **`<h2>`** = discussion title. |
| **3.2** | CSS tweaks so headings stay dense (`app/styles.css` or local classes). |

**Acceptance:** Exactly one `h1` per page; hierarchy per spec.

---

## Track 4 — Financial rollup (§4)

| Task | Description |
|------|-------------|
| **4.1** | `lib/project-financials` (or equivalent): grand total **excludes** hours-derived USD; remove/stop combined helper if product rule is strict. |
| **4.2** | `app/[id]/page.tsx`: hours rows show **hours only**; remove per-row rate/USD and hours USD subtotal; label grand total clearly (e.g. “Total (expenses)”). |

**Acceptance:** No USD in hours section; grand total = expense subtotal.

**Tests:** Unit tests for financial helpers per spec testing expectations.

---

## Track 5 — Archived clients (§5)

Depends on **Track 0** + env `DROPBOX_ARCHIVED_CLIENTS_ROOT` (already in `.env.example`; user configures).

### Agent 5A — Schema and RLS

| Task | Description |
|------|-------------|
| **5A.1** | Migration: `clients.archived_at` (nullable timestamptz); status fields (`dropbox_archive_status`, `archive_started_at`, `archive_error` or names aligned with Track 0). |
| **5A.2** | RLS: archived clients still **readable**; align with existing `clients` policies. |

### Agent 5B — Dropbox and API orchestration

| Task | Description |
|------|-------------|
| **5B.1** | `lib/storage/dropbox-adapter.ts`: archive = `move_v2` active root → `DROPBOX_ARCHIVED_CLIENTS_ROOT`; un-archive reverse; validate roots; idempotent retry where safe. |
| **5B.2** | Routes: start archive/restore → `pending`/`in_progress` → background work (per Track 0); success → `completed` + `archived_at` + path updates; failure → `failed` + error. |
| **5B.3** | **GET** exposing status fields for **polling** (§ Locked transport). |

### Agent 5C — Enforcement

| Task | Description |
|------|-------------|
| **5C.1** | Helper: block mutations when `archived_at` set **or** status `pending` / `in_progress`. |
| **5C.2** | Apply to create project, create discussion, post comment, upload/complete upload — **4xx** + clear message. |

**Files:** `lib/repositories.ts`, relevant `app/**/route.ts`

### Agent 5D — UI and polling UX

| Task | Description |
|------|-------------|
| **5D.1** | Settings/clients: Archive / Restore + confirm; filter archived from pickers (e.g. create project). |
| **5D.2** | Transfer UI: indeterminate progress, phased copy, elapsed/last updated; **HTTP poll every 2 s** until terminal; survives navigation; inline error + Retry. |
| **5D.3** | Same for un-archive. |

**Acceptance:** Full §5 acceptance + § Locked transport (no SSE/Realtime for v1).

**Tests:** API rejection tests; optional mocked Dropbox; UI test with mocked status sequence and polling.

---

## Suggested execution order

1. **Track 0**
2. **Track 1** then **Track 2**, or parallel if two agents and no file conflicts
3. **Track 3** and **Track 4** in parallel with each other once workspace shell is stable
4. **Track 5:** **5A → 5B → 5C → 5D** (strict order)

---

## Verification gate

- Targeted Vitest for financials + archive API; `npm run test` if many routes change.
- Manual: billing badge, discussion headings, archive poll UX, mutation blocks.
- Do **not** commit `.env.local` or secrets.

---

## Related files (implementation hints)

| Area | Files |
|------|--------|
| Workspace | `components/projects/projects-workspace-shell.tsx`, `projects-workspace-context.tsx`, `projects-billing.tsx`, `projects-archive.tsx` |
| Header | `app/header.tsx` |
| Discussion | `app/[id]/[discussion]/page.tsx` |
| Financials | `app/[id]/page.tsx`, `lib/project-financials.ts` |
| Clients / DB | `supabase/migrations/*`, `lib/repositories.ts` |
| API | `app/projects/route.ts`, discussion/comment/file routes |
| Dropbox | `lib/storage/dropbox-adapter.ts` |

---

## Revision history

| Date | Author | Notes |
|------|--------|-------|
| 2026-04-02 | Plan | Initial multi-agent plan from spec |
