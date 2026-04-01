# Round 7 — BC2 migration skip existing files — implementation plan

**Status:** Pending  
**Spec:** [2026-04-01-round-7-bc2-migration-skip-existing-files-design.md](../specs/2026-04-01-round-7-bc2-migration-skip-existing-files-design.md)

**Resolved:** Add **BC source id column** + **partial unique index** `(project_id, bc_id)` — see spec § Resolved.

---

## Goal

Make BC2 file migration **idempotent**: skip files that already exist from previous runs.

---

## Discovery

- [ ] Locate file import path (CLI script, server route, or job).
- [ ] Map BC2 export field → new column; **add Supabase migration** before importer changes.

---

## Files (typical)

| Area | Action |
|------|--------|
| Schema | New migration: nullable BC id column + **partial unique index** where BC id is not null |
| Importer | `lib/` or `scripts/` BC2 file import — **SELECT** / upsert **skip** on conflict |
| Tests | `tests/unit` for dedupe helper |

---

## Tasks

- [ ] **Step 1:** Add migration + types; document column name in spec handoff.
- [ ] **Step 2:** In import loop, `continue` when existing row found; aggregate `skipped` counts.
- [ ] **Step 3:** Add unit test with mocked DB or in-memory repository.
- [ ] **Step 4:** Dry-run on staging copy: rerun migration, confirm **0 new duplicates**.
- [ ] **Step 5:** `npm run test`.

---

## Handoff

- Schema change: document new column + index in final PR notes.
- Ops: log line format for skipped files.
