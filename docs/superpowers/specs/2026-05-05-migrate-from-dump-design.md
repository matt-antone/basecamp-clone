# Migrate from BC2 Dump — Design

**Date:** 2026-05-05
**Status:** Draft
**Owner:** Matt

## Context

We have built a one-shot dump tool (`scripts/dump-bc2.ts`) that mirrors the
entire Basecamp 2 account to local JSON at `/Volumes/Spare/basecamp-dump/`.
Binary attachments are intentionally **not** dumped — the local drive cannot
hold them — so attachment bodies remain only on Basecamp's servers.

The existing `scripts/migrate-bc2.ts` reads live from the BC2 API and writes
into Postgres + Dropbox. Going forward BC2 is read-only; no new content is
being added there. The dump is now the canonical source of truth, but the
live BC2 API must remain reachable for two reasons:

1. The dump contains JSON only — attachment binaries must still be streamed
   from BC2 during migration.
2. The dump may have gaps (failed fetches recorded in `errors.json`, or
   topics added after the dump completed) — we want the migrator to
   transparently fall back to the API on a per-record basis rather than
   erroring out.

## Goals

- Build a new entry point `scripts/migrate-from-dump.ts` that reads from the
  local dump and writes the same DB shape the old script produces.
- Treat the dump as primary; fall back to live BC2 API when a record is
  missing from the dump or recorded as errored.
- Stream attachment binaries from BC2 → Dropbox during the file phase. No
  local disk hop.
- Preserve idempotency, resumability, and the existing migration job /
  records tables. Operators see the same dashboards.
- Extract just the shared migration logic the new script needs into
  `lib/imports/migration/`. The old `migrate-bc2.ts` is left in place as a
  historical artifact.

## Non-Goals

- Refactoring `migrate-bc2.ts`. Old script is not touched in this work.
- Building a delta sync (no new BC2 data is being created).
- Persisting attachment binaries locally.
- Replacing the import_jobs / import_logs schema.

## Architecture

### File layout

```
scripts/
  migrate-bc2.ts                  # existing, untouched
  migrate-from-dump.ts            # NEW entry point

lib/imports/
  bc2-client.ts                   # existing, used as API fallback
  bc2-fetcher.ts                  # existing, used as API fallback
  bc2-transformer.ts              # existing, JSON → DB shape
  bc2-attachment-download.ts      # existing, BC2 binary stream
  bc2-attachment-linkage.ts       # existing
  bc2-migrate-single-file.ts      # existing
  dump-reader.ts                  # NEW — file-backed reader + API fallback

lib/imports/migration/            # NEW shared lib
  jobs.ts                         # createMigrationJob, logRecord, finishJob
  people.ts                       # migratePeople(reader, ...)
  projects.ts                     # migrateProjects(reader, ...)
  threads.ts                      # migrateThreadsAndComments(reader, ...)
  files.ts                        # migrateFiles(reader, ...)
  types.ts                        # CliFlags, MigratedProject, etc.
```

The new `migration/*` modules are seeded from the corresponding functions in
the old `migrate-bc2.ts` (copy + adapt to take a `DumpReader` argument). The
old script keeps its own private copies. No shared imports between old and
new — they evolve independently.

### DumpReader

`DumpReader` is the only component that knows about the dump's directory
layout. Migration phases call typed methods on it; they do not touch the
filesystem.

```ts
// lib/imports/dump-reader.ts

export interface DumpSource<T = unknown> {
  source: "dump" | "api";
  body: T;
}

export interface DumpReader {
  people(): Promise<DumpSource<Bc2Person[]>>;
  activeProjects(): Promise<DumpSource<Bc2Project[]>>;
  archivedProjects(): Promise<DumpSource<Bc2Project[]>>;
  topics(projectId: number): Promise<DumpSource<Bc2Topic[]>>;
  topicDetail<T = unknown>(
    projectId: number,
    topicableType: string,
    topicableId: number,
  ): Promise<DumpSource<T>>;
  attachments(projectId: number): Promise<DumpSource<Bc2Attachment[]>>;
  attachmentBinary(
    projectId: number,
    attachmentId: number,
    url: string,
  ): Promise<ArrayBuffer>;
}

export function createDumpReader(opts: {
  dumpDir: string;
  client: Bc2Client;
  errors: Set<string>; // paths from dump/errors.json
}): DumpReader;
```

Resolution rule for every JSON-returning method:

1. Compute the dump path for the request.
2. If the dump file exists, is non-empty, and the path is not in the
   `errors` set → read from disk, return `source: "dump"`.
3. Otherwise → call `Bc2Client.get(...)`, return `source: "api"`.

`attachmentBinary` always streams from BC2 — binaries are never on disk.

The `errors` set is built once from `dump/errors.json` at startup. The
manifest itself is read for sanity-checks and printed counts.

## CLI

```
pnpm tsx scripts/migrate-from-dump.ts \
  [--phase=people|projects|threads|files|all]   default: all
  [--projects=active|archived|all]              default: all
  [--limit=N]                                    optional project cap
  [--project-id=N]                               single project
  [--dump-dir=/Volumes/Spare/basecamp-dump]      override env
  [--dry-run]                                    no DB or Dropbox writes
  [--no-files]                                   skip binary file phase
```

`BASECAMP_DUMP_DIR` env is also honored. Default
`/Volumes/Spare/basecamp-dump`.

## Phase flow

When `--phase=all`:

1. **Init**
   - Connect `pg.Pool` from `DATABASE_URL`.
   - Construct `Bc2Client` from existing env vars.
   - Read `dump/manifest.json` (logged for visibility) and `dump/errors.json`
     (loaded into Set).
   - Construct `DumpReader`.
   - `createMigrationJob({ source: "dump" })` → `jobId`.

2. **People**
   - `reader.people()` → `migratePeople()` → upserts into existing
     `bc2_people_map`.

3. **Projects**
   - `reader.activeProjects()` + `reader.archivedProjects()`.
   - Filter by `--projects` flag.
   - Apply `--project-id` and `--limit`.
   - `migrateProjects()` creates DB `projects` rows, plans dup-suffix slugs,
     creates Dropbox folders, populates `bc2_projects_map`.

4. **Threads**
   - For each migrated project (concurrency: 1 — same as old script):
     - `reader.topics(projectId)` → list of topic summaries.
     - For each topic: `reader.topicDetail(projectId, topicable.type,
       topicable.id)` → run through `bc2-transformer` → `createThread` +
       `createComment` repository calls. Skip topicable types we don't
       handle (calendar events on BC2 → no analog yet) and log the skip.

5. **Files** (skipped if `--no-files`)
   - For each migrated project:
     - `reader.attachments(projectId)` → list.
     - For each attachment, fetch existing BC2 file linkage from `bc2-attachment-linkage`.
     - `reader.attachmentBinary(projectId, attachment.id)` returns a stream.
     - Hand the stream to `importBc2FileFromAttachment` (existing helper) so
       it goes Dropbox + writes file metadata via `createFileMetadata`.

6. **Finalize**
   - `finishJob(jobId, "completed" | "failed" | "interrupted")`.
   - Print summary including dump vs API split.

`--phase=people|projects|threads|files` runs only the named phase. Useful
for retry of one phase after fixing a fault.

## Error handling

| Scenario | Behavior |
| --- | --- |
| Dump JSON present, valid | Use it. `source: "dump"`. |
| Dump JSON missing | Fallback to BC2 API. `migration_record.source = "api"`, `reason = missing_dump_file`. |
| Dump JSON path in `errors.json` | Fallback to BC2 API. `reason = dump_errored`. |
| BC2 API succeeds after retry | Use returned body. Same as old script. |
| BC2 API fails (after rate-limit retries) | Mark this record `migration_record.status = failed`. Phase continues. |
| Attachment binary 404 / 410 | Mark file as failed; phase continues. Operator retries later. |
| Postgres write error | Fail the whole job (`status = failed`). DB integrity is non-negotiable. |
| Already-migrated record (`import_map_*` hit) | Skip silently. Idempotency unchanged. |

Every record written produces a `import_logs` row with phase, bc2_id,
db_id, status, `source` ("dump" or "api"), and error message (if any). The
operator can audit the run with:

```sql
SELECT data_source, COUNT(*)
FROM import_logs
WHERE job_id = '<id>'
GROUP BY data_source;
```

Resumability is unchanged: rerunning skips records already in `import_map_*`.

## Testing

### Unit tests (`tests/unit/`)

- `dump-reader.test.ts` — covers
  1. JSON file present → returns `source: "dump"` body.
  2. JSON file missing → calls `Bc2Client.get`, returns `source: "api"`.
  3. Path listed in `errors` set → bypasses disk, calls API.
  4. `attachmentBinary` always uses `Bc2Client` (never reads disk).
  Mocks: fs (in-memory map) and `Bc2Client`.

- `migration/people.test.ts`, `migration/projects.test.ts`,
  `migration/threads.test.ts`, `migration/files.test.ts` — drive each phase
  with a mock `DumpReader`. Assert correct repository calls and
  `import_map_*` upserts. Reuse fixtures from `tests/fixtures/bc2/` where
  available; add new ones as needed.

### Integration test (`tests/integration/`)

- `migrate-from-dump.test.ts`
  - Build a fixture dump in a temp dir: 2 people, 2 projects (1 active, 1
    archived), 3 topics across them, 1 attachment metadata blob.
  - Stub the BC2 server (existing harness if any, else a small in-test
    fetch shim) for: 1 missing topic detail (forces fallback), 1
    attachment binary stream.
  - Run `migrate-from-dump` against the test database.
  - Assert: projects, threads, comments, files rows present; source
    counts in `import_logs` match expectations (one "api" row for
    the forced fallback); rerun is a no-op.

### Manual smoke sequence

1. `pnpm tsx scripts/migrate-from-dump.ts --project-id=20190031 --dry-run`
   → log only.
2. `--project-id=20190031 --no-files` → DB rows only.
3. `--project-id=20190031` → full path including Dropbox upload.
4. `--limit=5` → small batch.
5. Full run.

### Rollback

Existing `pnpm db:reset-bc2-data` clears all bc2-imported rows. Works
unchanged for this script.

## Open questions / risks

- **`import_logs.data_source` column (decided).** Schema check confirmed
  `import_logs` has no `source` column. Plan adds migration `0029` to add
  `data_source text not null default 'api'` and the new script writes
  `'dump'` or `'api'` per record. Default keeps old script's behavior
  unchanged.
- **BC2 attachment URL freshness.** Some attachment URLs require a fresh
  authenticated request. The existing `bc2-attachment-download.ts` already
  handles this. Reused as-is.
- **Calendar events.** The dump captures them but the destination DB has
  no analog yet. Phase logs `skipped_topic_type=CalendarEvent` and moves
  on. Future work to add a calendar table is out of scope.
- **Concurrency.** Old script uses `CONCURRENCY = 1` for projects to keep
  BC2 happy. New script keeps the same default; the dump-only path could
  go higher but mixing in API fallbacks means we should not assume
  unbounded parallelism. Re-evaluate after first full run.
