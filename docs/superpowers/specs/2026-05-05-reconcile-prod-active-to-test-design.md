# Reconcile Prod-Active Projects Into Test — Design

**Date:** 2026-05-05
**Status:** Draft
**Owner:** Matt

## Context

Test DB has been freshly populated from the BC2 dump via
`scripts/migrate-from-dump.ts` and is considered the canonical, clean
representation of BC2 data. Production DB has bad data: the original
buggy migration mis-linked content, so prod's active projects contain
files and discussions whose `created_at` predates the project's own
`created_at`.

We want to reconcile what test holds about prod's *active* projects
without disturbing test's clean baseline. Test rows are not deleted;
prod is read-only; only items that exist in prod and not in test are
appended to test, and only when they pass an orphan-cutoff filter.

This is a one-way prod → test sync, scoped to active projects, content
matched by fingerprint instead of ID because IDs differ across
databases.

## Goals

- Build `scripts/reconcile-prod-active-to-test.ts` that, for each
  prod-active project, brings test's content into alignment with prod's
  by inserting prod-only files, discussions, and comments.
- Drop any prod content with `created_at < project.created_at`
  (orphan filter), preserving test's correctness.
- Match content by fingerprint (filename+size+created_at OR
  dropbox_path for files; title+body_hash+created_at for discussions;
  body_hash+author+created_at for comments). Never compare by row IDs.
- Bridge identities through `bc2_projects_map` (projects),
  `bc2_people_map` (authors), and `clients.code` (clients).
- Never modify prod. Never delete from test.
- Produce auditable CSVs and a `reconcile_jobs` log row per run.

## Non-Goals

- Modifying prod data in any way.
- Deleting or re-linking content already in test.
- Re-migrating from BC2 dump (that is `migrate-from-dump.ts`'s job).
- Producing a prod-cleanup report (out of scope; prod is fixed by a
  later swap or separate effort).
- Building a delta sync that runs on a schedule.
- Refactoring `migrate-bc2.ts` or `migrate-from-dump.ts`.

## Architecture

### File layout

```
scripts/
  reconcile-prod-active-to-test.ts   # NEW entry point

lib/imports/reconcile/               # NEW
  prod-reader.ts                     # read-only prod queries
  test-writer.ts                     # test DB inserts (per-project tx)
  diff.ts                            # presence checks, returns prod-only sets
  fingerprints.ts                    # pure fingerprint fns
  orphan-filter.ts                   # cutoff helper
  mappers.ts                         # projects/people/clients bridges + cache
  reconcile-job.ts                   # reconcile_jobs / reconcile_logs writers
  types.ts
```

The reconcile module shares no imports with `lib/imports/migration/*`.
Both DBs already have `bc2_projects_map` and `bc2_people_map`; small
shared types live in `lib/imports/maps.ts` if helpful.

### Connections

Two `pg.Pool` instances:

- `prodPool` — `PROD_DATABASE_URL`, read-only role enforced at the DB
  level. The script also issues `SET TRANSACTION READ ONLY` at the
  start of every prod query batch as belt-and-suspenders.
- `testPool` — `DATABASE_URL` (test). Per-project transactions on this
  pool.

### CLI

```
pnpm tsx scripts/reconcile-prod-active-to-test.ts \
  [--project-id=<bc2_id>]      single project; otherwise all prod-active
  [--limit=N]                  cap projects processed
  [--dry-run]                  diff but write nothing to test
  [--out-dir=tmp/reconcile]    CSV + summary destination
```

Backup gate: the script prints the test connection target + DB size
and aborts unless `RECONCILE_CONFIRM=yes` is set in the environment.

## Data flow

For each prod project where `archived = false`:

1. **Bridge** — `prodPool.bc2_projects_map` lookup yields `bc2_id`. If
   missing → append to `unmapped-active.csv` and skip.
2. **Locate test project** — `testPool.bc2_projects_map` lookup by
   `bc2_id`. If missing → create the test `projects` row by copying
   from the prod row (title, slug, dates, description, etc.) and
   resolve the client via `clients.code` (see §Map mediation). Insert
   the corresponding `test.bc2_projects_map` row.
3. **Cutoff** — `cutoff = prodProject.created_at`.
4. **Files phase** — list prod files, drop where
   `created_at < cutoff`, diff against test files for the matched test
   project, insert prod-only files. Authors mapped via
   `bc2_people_map`; an unmappable author skips just that file.
5. **Discussions phase** — same pattern with discussion fingerprint.
   Track `prod_discussion_id → test_discussion_id` for step 6.
6. **Comments phase** — for every test discussion that maps to a prod
   discussion (newly inserted or pre-existing), diff comments and
   insert prod-only ones.

Concurrency is one project at a time. Each project runs in a single
`testPool` transaction so partial inserts cannot leak.

## Fingerprints

Pure functions in `fingerprints.ts`:

```ts
fileFpA(f) = `${f.filename}|${f.size}|${toIsoMs(f.created_at)}`
fileFpB(f) = f.dropbox_path ?? null

discussionFp(d) =
  `${d.title}|${sha256(normalize(d.body))}|${toIsoMs(d.created_at)}`

commentFp(c) =
  `${sha256(normalize(c.body))}|${c.author_test_user_id}|${toIsoMs(c.created_at)}`
```

Rules:

- Files match if either the A or B key matches an existing test row.
  This handles re-uploads (same content metadata, different path) and
  renames (same path, different filename).
- `normalize(body) = body.replace(/\r\n/g, "\n").trimEnd()`.
- `toIsoMs` truncates to millisecond precision to absorb cross-DB
  microsecond drift.
- Comments include the **test-side** author id in the fingerprint (the
  prod author has already been mapped through `bc2_people_map`),
  ensuring identical comment text by different authors is treated as
  distinct.
- Null `dropbox_path` → `fileFpB` is skipped, only A applies.
- Null body → hash of empty string. Stable.

## Orphan filter

```ts
function applyOrphanFilter<T extends { created_at: Date }>(
  items: T[],
  project: { created_at: Date },
): { kept: T[]; dropped: T[] };
```

- Strict `<` cutoff. Items whose `created_at` equals
  `project.created_at` are kept.
- Applied to files, discussions, and comments alike. For comments, the
  cutoff is the project's `created_at` (not the parent discussion's).
- Dropped items go to `orphans-dropped.csv`.

## Map mediation

| Domain | Bridge | Miss handling |
| --- | --- | --- |
| Projects | `bc2_projects_map` (both DBs), keyed by `bc2_id` | Prod miss → `unmapped-active.csv`; test miss → create test project from prod row |
| People | `bc2_people_map` (both DBs), keyed by `bc2_id` | Either miss → append `unmapped-people.csv`, skip the affected item, project tx still commits |
| Clients | `clients.code` equality | Test miss → `unresolved-client.csv`, skip the project entirely |

In-memory caches per run:
- `Map<number, number>` for prod project_id → bc2_id
- `Map<number, number>` for bc2_id → test project_id
- `Map<number, number>` for prod user_id → bc2_id
- `Map<number, number>` for bc2_id → test user_id
- `Map<string, number>` for client_code → test client_id

Caches are populated lazily on first use.

## Outputs

CSV artifacts in `--out-dir/<timestamp>/`:

| File | Columns |
| --- | --- |
| `unmapped-active.csv` | prod_project_id, title, client_code, prod_created_at |
| `unresolved-client.csv` | prod_project_id, title, prod_client_code |
| `unmapped-people.csv` | prod_user_id, email, name, encountered_in (file/discussion/comment), prod_item_id |
| `orphans-dropped.csv` | project_bc2_id, project_title, item_type, item_id, item_created_at, project_created_at, delta_seconds |
| `inserted.csv` | project_bc2_id, item_type, prod_id, test_id, fingerprint |
| `skipped-duplicate.csv` | project_bc2_id, item_type, prod_id, matched_test_id, matched_by (fpA / fpB / discussionFp / commentFp) |

Stdout/`summary.json`:

```
Run: <iso-timestamp>   dry-run: <bool>
Prod active projects: N
  Unmapped (skipped): n      → unmapped-active.csv
  Unresolved client (skipped): n → unresolved-client.csv
  Synced: n

Per phase:
  Projects created in test: n
  Files:        inserted n   duplicate n   orphan n
  Discussions:  inserted n   duplicate n   orphan n
  Comments:     inserted n   duplicate n   orphan n
  People skips: n            → unmapped-people.csv

Wall time: <duration>
```

### Schema migration `0030_reconcile_logs`

```sql
CREATE TABLE reconcile_jobs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running','completed','failed','interrupted')),
  dry_run boolean not null,
  summary_json jsonb
);

CREATE TABLE reconcile_logs (
  id bigserial primary key,
  job_id uuid not null references reconcile_jobs(id),
  project_bc2_id bigint,
  phase text not null check (phase in ('project','file','discussion','comment')),
  action text not null check (action in ('inserted','duplicate','orphan','skipped','error')),
  prod_id bigint,
  test_id bigint,
  reason text,
  created_at timestamptz not null default now()
);

CREATE INDEX reconcile_logs_job_id_idx ON reconcile_logs(job_id);
CREATE INDEX reconcile_logs_project_bc2_id_idx ON reconcile_logs(project_bc2_id);
```

## Error handling

| Scenario | Behavior |
| --- | --- |
| Prod read fails | Fail run immediately. Exit non-zero. No test writes occurred. |
| Test write fails inside per-project tx | Roll back that project's tx. Log `error` row. Continue with next project. Exit code 1 if any project errored. |
| Prod row changes mid-run | Per-project snapshot read; staleness across projects acceptable. |
| Dry-run | Diffs computed; CSVs written including planned inserts; no `INSERT` issued; `reconcile_jobs.dry_run = true`. |
| Re-run | Idempotent via fingerprint diff. No `--resume` flag needed. |
| SIGINT | Mark `reconcile_jobs.status = interrupted`, flush CSVs, exit 130. |
| Author missing in either map | Skip the item, append `unmapped-people.csv`, log `skipped`, project tx still commits other items. |
| Body > 1MB | Hash via streaming sha256; no special handling. |
| Multiple prod rows share fingerprint | Insert each separately. Preserve duplication that exists in prod. |
| One test row matches multiple prod rows | All matching prod rows logged `duplicate` against the same `matched_test_id`. |
| Microsecond timestamp drift | Absorbed by `toIsoMs` truncation. |
| Zero prod-active projects | Summary prints zeros. Exit 0. |

DB safety:

- Per-project transaction on test pool. No cross-DB transactions.
- No DDL inside the script. Schema changes via `0030_reconcile_logs`.
- `RECONCILE_CONFIRM=yes` env var required to perform writes; missing
  env aborts even outside dry-run.
- Per global memory, a verified DB backup of the test DB is a
  prerequisite for any non-dry-run invocation.

Rollback for a completed run:

```sql
DELETE FROM <table> t USING reconcile_logs l
WHERE l.job_id = $1 AND l.phase = '<phase>' AND l.action = 'inserted'
  AND l.test_id = t.id;
```

Run for each phase in reverse order (comments → discussions → files →
projects). SQL templates documented in the script header.

## Testing

### Unit tests (`tests/unit/reconcile/`)

| File | Coverage |
| --- | --- |
| `fingerprints.test.ts` | A/B file keys, discussion + comment fps, body normalization (\r\n, trailing ws), null handling, ms truncation |
| `orphan-filter.test.ts` | Strict `<`, equal-timestamp kept, mixed split |
| `diff.test.ts` | A-only / B-only / either-match / neither-match; duplicate prod rows; multi-prod → single-test mapping |
| `mappers.test.ts` | Project/people/client miss flows; cache hits |

### Integration tests (`tests/integration/reconcile-prod-active-to-test.test.ts`)

Two ephemeral schemas (prod_*, test_*) in the test Postgres container.

Scenarios:

1. Happy path — mix of new and duplicate files/discussions/comments;
   assert per-phase insert/duplicate counts.
2. Orphan filter — file `created_at < project.created_at`; dropped,
   recorded in CSV.
3. Unmapped project — `unmapped-active.csv`, no test writes.
4. New test project creation — content synced into newly created test
   project + map row.
5. Unresolved client code — project skipped, CSV row written.
6. Unmapped author — affected item skipped, project tx commits the
   rest.
7. Re-run idempotency — second run inserts zero.
8. Per-project tx rollback — induced write failure rolls back only
   that project; first project's commit persists; exit code 1.
9. Dry-run — no test writes; `inserted.csv` shows planned inserts;
   `reconcile_jobs.dry_run = true`.

### Manual smoke

1. `--project-id=<known-good-bc2-id> --dry-run`
2. Same project, no `--dry-run`
3. Re-run same → zero inserts
4. `--limit=5`
5. Full run

## Open questions / risks

- **Dropbox path semantics across envs.** Prod and test may share the
  same Dropbox account or use separate folders. The script writes
  prod's `dropbox_path` verbatim into test rows; if the binary lives
  in a folder the test environment cannot reach, downstream consumers
  in test will 404. Confirm before first non-dry-run that prod and
  test reference the same Dropbox tree, or add a path-rewrite step.
- **Prod-native users.** Users created post-migration in prod have no
  `bc2_id`. Items they authored will be skipped. Acceptable per Q14
  but the volume should be checked early.
- **Project-active in prod, archived in BC2.** Per Q7, prod's flag
  wins. Test's row (if it exists from `migrate-from-dump`) may say
  archived; reconcile does NOT flip the flag in test. The flag
  divergence is intentional — test reflects BC2 truth + prod's
  content overlay. If the user later wants flag alignment, that is a
  separate one-line update step.
- **Schema drift.** Files / discussions / comments columns must match
  between prod and test. Any column present in prod but not test will
  be ignored on insert; missing required columns in prod will cause
  insert failure. Spot-check schemas before first run.
- **Comment author fingerprint.** Comments use test-side author id in
  the fingerprint (after mapping). If the same prod author is
  authored two comments and the bc2_people_map maps both to the same
  test user, they are still distinguished by body hash + timestamp.
- **Backup verification.** Per global memory, must confirm a verified
  test DB backup exists before any write run. The
  `RECONCILE_CONFIRM=yes` gate is the explicit attestation.
