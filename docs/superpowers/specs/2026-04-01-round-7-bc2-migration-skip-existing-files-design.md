# Round 7 — BC2 migration: skip files that already exist from prior runs

**Date:** 2026-04-01  
**Status:** Draft (brainstorm Round 7)  
**Type:** Data migration / idempotency

---

## Resolved (2026-04-01)

| Decision | Answer |
|----------|--------|
| **Schema** | **Yes** — add a **dedicated column** for the Basecamp 2 attachment/source identifier on the files table (exact name TBD in implementation, e.g. `bc_attachment_id` or `bc_source_attachment_id`), **nullable** for non-BC uploads. |
| **Uniqueness** | **Unique index** on **`(project_id, <bc_column>)`** where `bc_column` **IS NOT NULL** (partial unique index) so the same BC attachment cannot be inserted twice per project; **skip** import when row exists. |
| **Fallback** | **Heuristic-only dedupe** without BC id is **out of scope** for v1 once the column exists; legacy rows with `NULL` BC id may need a one-time backfill or remain out of dedupe scope (document in implementation). |

---

## Problem

Re-running or overlapping **Basecamp 2 → app** file migration can create **duplicate file rows** or re-upload the same logical file when the same run is invoked multiple times or when incremental migrations overlap. Operators need **idempotent** behavior: **if a file already exists** (from a previous successful migration), **do not insert or upload again**.

---

## Goal

Define a stable **dedupe key** per file and ensure migration **skips** when that key already exists in the database (and optionally when blob storage already has the object).

---

## Non-goals

- Fixing unrelated attachment-to-thread bugs (separate Round 7 spec).
- Deleting already-created duplicates automatically (optional follow-up).

---

## Identity / dedupe strategy (chosen)

- **Primary:** BC2 **attachment / source id** stored in the new column; **unique per project** via partial unique index.
- **Implementation:** Final column name and BC export field mapping **confirmed in code** during implementation.

---

## Requirements

1. Before insert/upload, **query** for existing row matching dedupe key.
2. Log skip at **info** level (count of skipped vs imported).
3. Safe to run migration **N** times without growing file table for the same BC attachments.
4. Tests: unit test for “existing row → skip insert”.

---

## Related

- Prior plan: `docs/superpowers/plans/closed/2026-03-31-bc2-comment-attachments-migration.md`, `2026-03-29-bc2-migration.md`.
- Migration scripts under repo `scripts/` or `lib/` BC2 importers (confirm paths during implementation).
