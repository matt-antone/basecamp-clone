# Prod → Test Sync — Run Notes

**Run timestamp:** 2026-05-11T22:17:57Z (UTC)
**Run mode:** real apply (`--backup-confirmed`)
**Cutoff:** 2026-04-24T00:00:00Z
**Test DB backup:** `/Volumes/External/Glyphix Dropbox/Development Files/Under Development/Project Manager/basecamp-clone/backups/test-pre-sync-prod-to-test-20260511-145829.dump` (20 MB, pg_dump 17 custom format, taken pre-run)

## Summary

| metric | count |
|---|---|
| prod projects with post-cutoff activity | 48 |
| projects created in test (no prior match) | 24 |
| projects appended in test (existing match) | 24 |
| threads inserted | 149 |
| comments inserted | 79 |
| files inserted (with Dropbox copy `/Projects/` → `/Projects-test/`) | 177 |
| failed Dropbox copies | 0 |
| projects with warnings | 1 (`GX-0001` — 2 orphan-thread comments) |

The prior failed-attempt + retry produced the slight diffs vs the original dry-run forecast (153/79/185). 149 threads + 79 comments landed during the first attempt's committed transactions; the second run picked up the remaining work after the Dropbox `pathRoot` fix.

## Post-run test DB state (post-cutoff rows)

```
projects:  27  (24 newly created + 3 already had post-cutoff updated_at)
threads:   162
comments:  83
files:     186  (all 186 with /Projects-test/ dropbox_path)
```

import_map entries:
- `import_map_threads.prod_native_*`: 149
- `import_map_comments.prod_native_*`: 79
- `import_map_files.prod_native_*`: 177
- `import_map_projects.prod_native_*`: 0 (projects always have basecamp_project_id mappings preserved)

## Idempotency check

A subsequent dry-run produced:

```
done. projects=48 threads=0 comments=0 files=0 failed_copies=0
```

Re-running is a no-op.

## Known residual

`GX-0001` (Project Manager Project) has 2 post-cutoff comments whose parent prod thread (`8415846e-6fab-4fc7-a67c-1deac373f4e7`) was created pre-cutoff and has no `basecamp_thread_id` in prod's import map. The sync orchestrator can only resolve pre-cutoff parent refs via `basecamp_*_id` or a prior `prod_native_*` mapping; neither exists for this thread. The comments are dropped on each run; addressing them requires a follow-up pass that proactively fetches missing parent threads.

## Fixes applied during the run

Three small commits adjusted the implementation against issues that surfaced on the first dry-run attempt:

1. `fix(sync): include projects.slug in prod reader and project upsert` — projects table has both `slug` (NOT NULL UNIQUE) and `project_slug`; INSERT had to set both.
2. `fix(sync): include projects.created_by in prod reader and project upsert` — `projects.created_by` is NOT NULL; pull the prod value through.
3. `fix(sync): resolve pre-cutoff prod thread/comment refs via test import_map` — post-cutoff comments referencing pre-cutoff prod threads were resolving to NULL `thread_id`; added a fallback that looks up the test counterpart via `import_map_threads` keyed by `basecamp_thread_id` or `prod_native_<prod_id>`.
4. `fix(sync): resolve team root_namespace_id and use pathRoot for dropbox copy` — Dropbox is a team space; the original copy helper hit the user's home namespace where `/Projects/` doesn't exist, yielding `from_lookup/not_found` 409 for all 177 files. Mirrored the `DropboxStorageAdapter` pathRoot resolution and cached the team-rooted client across calls.

## Verification spot-checks (post-run)

- Random new test row (e.g. `BRGS-0078`) appears in the app under its client.
- A post-cutoff file row has `dropbox_path` pointing at `/Projects-test/...` and Dropbox confirms the file exists at that location.
- Thumbnail enqueue calls returned `worker_http_404` from the thumbnail worker for the new rows — gracefully handled by `enqueueThumbnailJobAndNotifyBestEffort`. Thumbnails will be regenerated on the next worker run or app-side trigger.
