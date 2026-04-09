## Full Basecamp Export Readiness Plan

### Summary
- Current client is **not export-ready** for this goal. It is scoped to starred projects, time-windowed queries, and upload-only attachments.
- Add a **dedicated CLI export pipeline** that exports **all visible projects** and **all available history**, includes **active + archived + trashed** records, downloads file binaries when available, and preserves relationships in a graph manifest.

### Implementation Changes
- Add a new export capability (separate from existing MCP query tools) with:
  - `npm run export -- --statuses active,archived,trashed --output <dir> --resume`
  - Default output path: `./exports/basecamp-<timestamp>/`
- Extend API client to support:
  - Full project listing by `status`
  - Link-header pagination traversal (instead of fixed `page <= 10`)
  - Recording, comments, vault/uploads traversal for full graph extraction
  - File download for upload/download URLs where available
- Build an export graph model:
  - Nodes: project, recording, message, comment, document, upload, vault, todo, todolist, person
  - Edges: `IN_PROJECT`, `PARENT_OF`, `COMMENTS_ON`, `CREATED_BY`, `HAS_FILE`, `IN_VAULT`
  - Preserve source IDs/URLs/status/timestamps for deterministic re-linking
- File handling policy:
  - Download binary files for downloadable uploads/attachments
  - Store external/linked files as metadata-only records (no binary fetch)
  - Deduplicate files by hash; keep manifest mapping each file to parent records
- Reliability and scale:
  - Checkpointing/resume state per project/type/page
  - Retry/backoff on rate limits and transient failures
  - End-of-run integrity report (counts by type, missing binary count, failed requests)
- OpenSpec/process updates:
  - Create new change for full export scope
  - Mark current `add-attachment-download` assumptions as superseded where they conflict with recording-based traversal

### Public Interfaces / Config Additions
- New CLI command: `export` (and `npm run export`)
- New optional env/config:
  - `BASECAMP_EXPORT_OUTPUT_DIR`
  - `BASECAMP_EXPORT_MAX_CONCURRENCY`
  - `BASECAMP_EXPORT_DOWNLOAD_TIMEOUT_MS`
  - `BASECAMP_EXPORT_INCLUDE_STATUSES` (default `active,archived,trashed`)
- Keep existing MCP tools unchanged for backward compatibility.

### Test Plan
- Unit:
  - Pagination via `Link` header traversal
  - Status-filtered project fetch (`active|archived|trashed`)
  - Relationship mapping correctness (`parent`, `bucket`, comments linkage)
  - File downloader behavior (downloadable vs linked metadata-only)
- Integration (mock Basecamp API):
  - Multi-project graph export with nested relationships
  - Resume after interruption
  - Deduped file writes and manifest consistency
- E2E:
  - CLI dry run + full run with artifact validation (`manifest`, `nodes`, `edges`, `files`)

### Assumptions
- Export scope includes **trashed** data.
- Export depth is **all available history** (paginate until exhausted).
- Linked external files are **metadata-only**.
- Existing starred-project MCP query behavior remains intact; export is a parallel capability.
