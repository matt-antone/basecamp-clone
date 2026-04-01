# Transition period — nightly BC2 sync — Design

**Date:** 2026-03-31  
**Status:** Draft (pending review)

**Related code:** `scripts/migrate-bc2.ts`, `lib/imports/bc2-fetcher.ts`, `lib/imports/bc2-client.ts`, mapping tables in `supabase/migrations/0001_init.sql` (`import_jobs`, `import_logs`, `import_map_*`).

**Companion spec (separate concern):** [Thumbnail enqueue after save](./2026-03-31-thumbnail-enqueue-after-save-design.md).

---

## 1. Overview

During the Basecamp 2 → app transition, re-run the existing BC2 migration on a schedule so **new** Basecamp activity (projects, and optionally messages/files per flags) lands in the app **without** manual runs, while **preserving** existing DB rows and avoiding duplicate entities via mapping tables.

This spec does **not** cover thumbnail generation or `thumbnail_jobs`; see the companion spec.

---

## 2. Source of truth

- **Basecamp 2 HTTP API** via existing `Bc2Client` / `Bc2Fetcher` inside `migrate-bc2.ts` (not a separate JSON drop for v1).

---

## 3. Safety — preserve existing data

- **No** truncate / full-table replace of app data.
- Rely on existing **idempotency**:
  - **Projects:** `import_map_projects` lookup → skip with log `"Already mapped"`; new projects use `ON CONFLICT (project_code) DO UPDATE` for selected fields (see script).
  - **Threads / comments / files:** corresponding `import_map_*` checks before insert.
- Each scheduled run **creates** a new `import_jobs` row (script already does this) for audit; operators use `import_logs` to see skips vs new work.

---

## 4. Scope of each run (defaults)

- **`--projects=active`** as default for “what’s live on the site” unless product explicitly wants `all` or a separate archived job.
- **`--files`:** include only if nightly runtime and Dropbox/BC2 rate limits are acceptable; otherwise a **second** scheduled job (e.g. weekly) or manual `--files` runs.
- **`--mode=full`:** acceptable if wall-clock fits the chosen runner; use **`--mode=limited`** with **`--limit=N`** for smoke tests or constrained environments.

Document chosen flags in deployment (README or internal runbook), not only in cron definition.

---

## 5. Runner options (pick one per environment)

| Option | When to prefer |
|--------|----------------|
| **A. GitHub Actions** `schedule` | Long runs, clear logs, secrets in repo settings; no Vercel function timeout. |
| **B. Vercel Cron → Route Handler** | Single platform; must finish within function max duration; secure with `CRON_SECRET` (or platform equivalent) on the route. |
| **C. Host / Mac cron + `npx tsx scripts/migrate-bc2.ts …`** | Full control; operator responsible for uptime and secret rotation. |

**Recommendation:** **GitHub Actions** or **host cron** for full `migrate-bc2.ts` with `--files` if duration is unknown; **Vercel Cron** only after measuring a **bounded** subset (e.g. active projects, no files, or low `--limit`).

---

## 6. Environment & secrets

- **`DATABASE_URL`** (script uses `Pool` + `DATABASE_URL` from `.env.local` pattern when run locally).
- Basecamp 2 credentials / workspace identifiers as already required by `migrate-bc2.ts`.
- Dropbox env vars as required by `DropboxStorageAdapter` for any run that uploads files.
- **Never** commit secrets; cron runner injects env from its secret store.

---

## 7. Failure handling

- Script already records failures per record and job status; nightly automation should **alert** on non-zero exit or `import_jobs.status` / failed counters beyond a threshold (implementation of alerting is out of scope for this spec — only **requirement** is that logs remain inspectable).

---

## 8. Non-goals (v1)

- **Bidirectional sync** (app → Basecamp).
- **Automatic refresh** of every column on already-mapped projects from BC2 on each run (today “already mapped” skips heavy re-upsert; changing that is a separate product decision).
- Replacing `migrate-bc2.ts` with a separate microservice (reuse script until transition ends).

---

## 9. Testing expectations

- Documented manual dry run (`--mode=dry` or `--mode=limited --limit=1`) before enabling schedule.
- Second run against the same data should show **mostly** “Already mapped” / no duplicate keys.

---

## 10. Open questions

1. Confirm production **`--projects`** (`active` vs `all`) and whether **`--files`** is included in v1 schedule.
2. Which runner option (**A / B / C**) is canonical for production?

---

## 11. Approval

- [ ] Product / owner sign-off on nightly scope (active vs all, files on/off).
- [ ] Engineering sign-off on runner choice and secrets location.

After approval, update **Status** to **Approved** and add an implementation plan under `docs/superpowers/plans/` (e.g. `2026-03-31-transition-nightly-bc2-sync.md`).
