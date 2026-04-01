# Round 7 — Google Spreadsheet data population — implementation plan

**Status:** **Paused** — same blockers as spec (stakeholder input).  
**Spec:** [2026-04-01-round-7-google-sheet-data-population-design.md](../specs/2026-04-01-round-7-google-sheet-data-population-design.md)

**Resolved:** v1 = **B — Scheduled sync** (nightly or similar cron → push to configured spreadsheet). **Not started** until spec pause lifted.

**Resume checklist:** Un-pause spec → answer entities, layout, auth, multi-tenant → then execute phases below.

---

## Goal

Implement **v1** scheduled Google Sheets sync per entity list, auth, and layout (once specified).

---

## Prerequisite

- [ ] Product completes remaining **Open questions** in spec (entities, auth model, sheet layout, multi-tenant).
- [ ] Google Cloud project: enable Sheets API; OAuth client or service account — **secrets in env only**.

---

## Phases

### Phase A — Spike

- [ ] **A1:** Hello-world: write rows to a test sheet via chosen auth path (service account or OAuth).
- [ ] **A2:** Document required OAuth scopes or SA JSON key handling.

### Phase B — App integration

- [ ] **B1:** **Cron-invoked** route (e.g. `GET /api/cron/google-sheets-sync` with `CRON_SECRET`) or Vercel Cron → calls sync orchestrator.
- [ ] **B2:** Load configured spreadsheet ID + tab names from **env** and/or **site_settings** (product decision).
- [ ] **B3:** Map DB rows → sheet rows (pure function + tests); define **replace vs clear-and-fill** per tab.
- [ ] **B4:** Settings UI (optional v1): spreadsheet URL/ID, last sync time, last error — or **env-only** for minimal v1.

### Phase C — Hardening

- [ ] **C1:** Rate limits / batching for large datasets.
- [ ] **C2:** Errors: SA key invalid, API quota, revoked OAuth — log + optional notification.
- [ ] **C3:** `npm run test`; manual test: trigger cron route locally with secret.

---

## Files (typical)

| Area | Files |
|------|--------|
| Cron | `vercel.json` schedule + `app/api/.../cron/.../route.ts` (pattern per existing cron in repo) |
| Settings | Optional: `app/settings` + site_settings columns for sheet id |
| Lib | `lib/google-sheets-sync.ts` — client + mappers |
| Tests | `tests/unit` for mapper + mocked API |

---

## Handoff

- List new **env vars** (`GOOGLE_CLIENT_ID`, etc.) in PR — **no values in repo**.
