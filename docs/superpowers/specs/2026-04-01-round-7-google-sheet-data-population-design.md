# Round 7 — Google Spreadsheet data population

**Date:** 2026-04-01  
**Status:** Draft — **paused** (stakeholder input pending)  
**Type:** Feature / integration

---

## Problem

Stakeholders want **project or financial data** exported or **kept in sync** with a **Google Sheet** for reporting, sharing with finance, or ad-hoc analysis.

---

## Resolved (2026-04-01)

| Decision | Answer |
|----------|--------|
| **v1 workflow** | **B — Scheduled sync** — a **job** (e.g. nightly cron) pushes rows to a **configured** spreadsheet. Manual one-shot export is **out of scope for v1** unless added later. |

---

## Deferred / not v1

| Option | Description |
|--------|-------------|
| **A — One-way export** | On-demand “Export to Sheets” from UI — possible **follow-up** after B is stable. |
| **C — Sheet as source** | Import from Google → app — **not** v1; higher risk. |

---

## Open questions (answer before build)

1. **Which entities?** Projects list, hours rollup, expenses, clients? (Can combine multiple tabs or one flat sheet — depends on answer.)
2. **Sheet layout:** Fixed template columns vs user-mapped?
3. **Auth:** Google OAuth (user-owned sheet) vs **service account** (workspace-owned doc)?
4. **Multi-tenant:** One sheet per workspace or one global sheet?

### Paused (2026-04-01)

**Product discovery is on hold** until the stakeholder provides input (starting with **which data** should appear in the sheet and any finance/reporting constraints). **Do not implement** this feature until the open questions above are answered and this pause is lifted (update **Status** to Draft or Approved).

**Already decided:** v1 workflow = **scheduled sync (B)** — still valid when work resumes.

---

## Non-goals (v1)

- Full bidirectional sync unless explicitly scoped later.
- Real-time push on every edit (unless product insists — then use Apps Script webhook or polling).

---

## Requirements (skeleton)

1. **Secure storage** of refresh tokens or service-account JSON via env (not committed).
2. **Schedule** documented (e.g. `vercel.json` cron or host cron) + **idempotent** writes (full replace vs append strategy TBD with entity choice).
3. **Observability:** log each run — success/failure, row counts, duration (and optional alert on failure).
4. **Tests:** mock Google API client; unit test row mapping.

---

## Related

- Google Sheets API v4; optional: `googleapis` npm package.
- Vercel Cron (or host cron) + `CRON_SECRET` header — align with existing scheduled jobs in the repo.
