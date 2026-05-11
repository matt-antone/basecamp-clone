# Audit BC2 Dump Reconciliation — Design

**Date:** 2026-05-08
**Status:** Draft
**Owner:** Matt

## Context

The first BC2 migration run (via `scripts/migrate-from-dump.ts`) completed
across the full account. The aggregate `import_logs.data_source` summary
shows the following buckets:

| Bucket | Count | Nature |
| --- | --- | --- |
| Successful imports (`null` message) | 53,088 | done |
| Already-mapped re-run hits | 3,674 | benign |
| Skipped-existing files re-run hits | 2,053 | benign |
| Orphan projects (no client match) | 17 | needs reconciliation |
| `CalendarEvent` skipped | 94 | permanently out of scope |
| `Todo` skipped | 40 | permanently out of scope |
| File "Failed to parse URL from undefined" | 44 | needs investigation |
| Transient errors (fetch failed / 409 / connection terminated) | 17 | likely re-run clears |

This spec covers the **first of four** reconciliation sub-projects:

1. **Audit (this spec)** — read-only, compares the BC2 dump to DB rows, produces CSVs that quantify expected vs. actual per entity and surfaces both expected skips and unaccounted-for gaps.
2. Orphan projects (later) — assign the 17 to clients or accept loss.
3. File URL bugs (later) — investigate the 44 `Failed to parse URL` rows.
4. Transient retry (later) — possibly just a focused re-run.

## Goals

- Read-only verification: zero DB writes, zero BC2 API calls.
- Per-record output that lists every dump entity and classifies it as
  `mapped` (in `import_map_*`), `failed` / `skipped_unsupported` /
  `skipped_existing` (logged in `import_logs`), or `missing`
  (unaccounted-for — present in dump, absent from both maps and logs).
- Aggregate summary so the operator can answer "how big is each
  reconciliation bucket?" at a glance.
- Output as CSV under `tmp/audit/` so the operator can grep, sort, or
  open in a spreadsheet.
- One-shot script. No phasing, no resumability — re-runs are cheap.

## Non-Goals

- Modifying `scripts/migrate-from-dump.ts` or any phase module. The
  migration is treated as immutable for this work.
- Modifying database schema. Audit is pure read.
- Implementing any of the other three reconciliation sub-projects.
- Live BC2 API fallback. The dump is the canonical source of truth.

## Hard Constraint — No Full Migration Re-Runs

The full migration is not run again, ever. The audit script itself
satisfies this trivially because it does not write to the database or
call the BC2 API. **This same constraint binds the three downstream
reconciliation specs (orphan projects, file URL bugs, transient retry).**
Each follow-up tool must operate on a precisely identified subset of
records — typically driven by the per-record CSVs produced here — and
never invoke `migrate-from-dump.ts` or its phases against the broader
dataset. Targeted SQL or targeted single-record helpers, yes; full-phase
orchestration, no.

## Architecture

### File layout

```
scripts/
  audit-bc2-dump.ts                # NEW one-shot entry point

lib/imports/audit/                 # NEW module
  reader.ts                        # iterate dump files into expected sets
  diff.ts                          # batch-load DB maps + logs, classify each expected entity
  csv-writer.ts                    # CSV output helpers
  types.ts                         # AuditFinding, AuditEntity, EntityStatus

tmp/audit/                         # gitignored output dir
  summary.csv
  people.csv
  projects.csv
  topics.csv
  comments.csv
  files.csv
```

`tmp/` will be added to `.gitignore` if it is not already ignored.

### Diff algorithm

Once per script run, in this order:

1. **Build expected sets from dump** (streaming, one project at a time
   for topics / comments / files):
   - People: `dump/people.json` → set of `bc2_id`.
   - Projects: union of `dump/projects/active.json` and `archived.json` → set of `bc2_id`.
   - Topics: per-project `dump/by-project/{id}/topics.json` → set of `(bc2_project_id, bc2_topic_id, topicable_type)`.
   - Comments: per-project, read each topic-detail file (`messages/{id}.json`, `todolists/{id}.json`, `uploads/{id}.json`, `documents/{id}.json`); extract `comments[]` → set of `(bc2_topic_id, bc2_comment_id)`.
   - Files: per-project `dump/by-project/{id}/attachments.json` → set of `(bc2_project_id, bc2_attachment_id, name, byte_size)`.

2. **Batch-load DB state** once at startup:
   - `select basecamp_person_id, local_user_profile_id from import_map_people`
   - `select basecamp_project_id, local_project_id from import_map_projects`
   - `select basecamp_thread_id, local_thread_id from import_map_threads`
   - `select basecamp_comment_id, local_comment_id from import_map_comments`
   - `select basecamp_file_id, local_file_id from import_map_files`
   - `select record_type, source_record_id, status, message from import_logs`
     — indexed in memory by `(record_type, source_record_id)`. The
     latest row wins when an ID appears more than once (job-level
     audit only needs the final disposition).

3. **Classify** each expected entity:
   1. If found in the corresponding `import_map_*`, status = `mapped`.
   2. Else look up `(record_type, source_record_id)` in the in-memory
      log index. If found:
      - `status = "failed"` and copy `import_logs.message` to `reason`.
      - Status `skipped_unsupported` when the message starts with
        `skipped_topicable_type=`.
      - Status `skipped_existing` when the message equals
        `skipped_existing` (the files phase emits this when
        `importBc2FileFromAttachment` returns the `skipped_existing`
        discriminant). Note: project-phase "Already mapped" rows never
        reach step 2 because they hit step 1 (`mapped`) first.
   3. Else `status = "missing"`, `reason = ""`. These are
      unaccounted-for and the principal value of the audit.

4. **Write CSVs** as we go, one row per expected entity. Stream — no
   accumulation of millions of rows in memory.

5. **Compute summary** by tallying status counts per entity at end.

### CSV schemas

**`summary.csv`** — top-level counts.

```
entity,expected,mapped,accounted_skip,accounted_fail,unaccounted
people,8,8,0,0,0
projects,3691,3674,0,17,0
topics,...
comments,...
files,...
```

`accounted_skip` = `skipped_unsupported` + `skipped_existing`.
`accounted_fail` = `failed`.
`unaccounted` = `missing`.

**`people.csv`**
```
bc2_id,email,name,status,local_user_profile_id,reason
```

**`projects.csv`**
```
bc2_id,name,archived,status,local_project_id,reason
```

**`topics.csv`**
```
bc2_project_id,bc2_topic_id,topicable_type,title,status,local_thread_id,reason
```

**`comments.csv`**
```
bc2_project_id,bc2_topic_id,bc2_comment_id,status,local_comment_id,reason
```

**`files.csv`**
```
bc2_project_id,bc2_attachment_id,filename,byte_size,status,local_file_id,reason
```

CSV escaping: any field containing `,`, `"`, or newline is double-quoted
and inner `"` doubled. Standard RFC 4180 conventions.

## CLI

```
pnpm tsx scripts/audit-bc2-dump.ts
  [--dump-dir=/Volumes/Spare/basecamp-dump]   default: env BASECAMP_DUMP_DIR or hard-coded
  [--out-dir=tmp/audit]                        default
  [--verbose]                                  per-project log lines
```

`pnpm audit:bc2-dump` is added as an npm-scripts shortcut.

The script reads `DATABASE_URL` from env (or `.env.local` in the cwd).
Default `--out-dir` is `tmp/audit/` relative to cwd; it is created if
missing and existing files are overwritten.

Exit codes:
- `0` — audit completed, regardless of how many `missing` rows were found.
- `1` — fatal error (DB connection failure, dump dir missing, malformed
  required JSON file, etc.).

## Error handling

| Scenario | Behavior |
| --- | --- |
| Dump dir missing or empty | Fatal — exit 1, error to stderr |
| `DATABASE_URL` unset | Fatal — exit 1 |
| Per-project topic-detail file missing while topic listed in `topics.json` | Treat as `missing` for that topic and any comments inside it. Logged in CSV. |
| `import_logs.message` malformed | Best-effort copy as-is; classify as `failed`. |
| pg connection error mid-run | Fatal — exit 1 (audit is short enough that retry isn't worth complexity). |

The script is read-only, so there is no rollback story. A failed run
leaves whatever partial CSVs were written; re-run overwrites them.

## Testing

### Unit tests (`tests/unit/`)

- `audit-reader.test.ts` — reuse `tests/support/dump-fixture.ts` to
  build a small fixture dump; assert each `reader.*` builds the
  correct expected set.
- `audit-diff.test.ts` — feed mock `import_map_*` data, mock
  `import_logs` rows, and a synthetic expected set; assert
  `mapped` / `failed` / `skipped_unsupported` / `skipped_existing` /
  `missing` classifications fire on the right inputs.
- `audit-csv-writer.test.ts` — verify column order, header row, and
  RFC 4180 escaping (commas in titles, quotes in messages, newlines
  in topic content).

No integration test against a real DB is required. The diff and reader
are pure functions; the script is a thin orchestrator.

### Manual smoke

```bash
pnpm audit:bc2-dump
ls -lh tmp/audit/
head tmp/audit/summary.csv
wc -l tmp/audit/*.csv
```

Expected on the current dataset (post-migration):

- `summary.csv` shows ~53k mapped, 17 unaccounted-for projects (or
  ~0 if the orphan path landed them with `failed` log rows), 134
  `accounted_skip` topics (94 calendar + 40 todo), 44
  `accounted_fail` files (URL parse failures), and ideally `0`
  unaccounted-for in any other column.
- Per-entity CSVs allow targeted follow-up: orphan project list →
  Spec 2 input, file URL fail list → Spec 3 input, etc.

## Open questions

None. Spec is closed-loop — no future work depends on this audit's
shape, only on its output, which is fixed by the CSV schemas above.
