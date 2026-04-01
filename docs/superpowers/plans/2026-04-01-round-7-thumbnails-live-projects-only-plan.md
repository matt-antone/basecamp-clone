# Round 7 — Thumbnails live projects only — implementation plan

**Status:** Done  
**Spec:** [2026-04-01-round-7-thumbnails-live-projects-only-design.md](../specs/2026-04-01-round-7-thumbnails-live-projects-only-design.md)

---

## Goal

Skip thumbnail enqueue for **archived** projects across upload and batch/sync paths.

---

## Files

| Area | Files |
|------|--------|
| Core | `lib/thumbnail-enqueue-after-save.ts` — add guard |
| Callers | Upload route(s), `bc2-*` migrate single-file if applicable, nightly sync entrypoint |
| Tests | `tests/unit/thumbnail-enqueue-after-save.test.ts`, `upload-complete-route.test.ts`, `bc2-migrate-single-file.test.ts` |

---

## Tasks

- [x] **Step 1:** Add helper `shouldEnqueueThumbnailForProject(project: { archived?: boolean })` (or pass `archived` boolean).
- [x] **Step 2:** At start of `enqueueThumbnailJobAndNotifyBestEffort`, return early if archived (document behavior).
- [x] **Step 3:** Ensure callers pass project archived flag or fetch project once (avoid N+1 on batch — batch may need project map).
- [x] **Step 4:** Update tests: archived → expect mock **not** called; live → unchanged.
- [x] **Step 5:** `npm run test` for touched tests.

---

## Notes

If upload route does not currently load `archived`, add a lightweight field to the existing project fetch used for authorization.
