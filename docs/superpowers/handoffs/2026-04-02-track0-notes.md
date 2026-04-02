# Track 0 handoff (spike notes)

- **Paths:** Project and file paths live in DB columns used by repositories and routes — e.g. `projects.storage_project_dir`, `project_files.dropbox_path` (see `grep` for `storage_project_dir`, `dropbox_path`, and `lib/storage/dropbox-adapter.ts`). For Track 5, after Dropbox `move_v2`, prefer **lazy path refresh** (re-read or patch paths when serving or on next mutation) unless batch backfill is required for consistency.
- **Background v1:** Use **`waitUntil`** (or equivalent) to continue work after responding **202 Accepted** with a **poll URL** for status; keep async work off the critical path and document max duration and retries in the archive/restore routes.
