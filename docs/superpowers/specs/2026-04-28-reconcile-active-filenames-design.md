# Reconcile Dropbox filenames for active projects

**Date:** 2026-04-28
**Status:** Draft

## Problem

Files uploaded by the BC2 import path were named with two redundant prefixes:

```
1775067993312-521625632-EPGGB-2026-newsletter01-layout-r2.pdf
^^^^^^^^^^^^^ ^^^^^^^^^
Date.now()    BC2 attachment.id
```

These prefixes are noise — Dropbox `filesUpload` already runs with `autorename: true`, so they served no collision-avoidance purpose. The upload code was fixed in commit `d5d77eb`. This spec covers the one-time backfill: rename existing prefixed files in Dropbox and update the `project_files.dropbox_path` column accordingly, scoped to **active (non-archived) projects only**.

## Goals

- Restore clean filenames in Dropbox for active projects.
- Keep `project_files.dropbox_path` in sync with the new Dropbox paths.
- Be safe to interrupt and resume.
- Surface (but do not touch) prefixed files in Dropbox that have no matching DB row.

## Non-goals

- Renaming files in archived projects.
- Stripping the single-prefix `^\d{13}-` form left by the regular upload path. (Out of scope for this run; existing direct-upload files are kept as-is.)
- Touching the `filename` column — it was already stored clean for both BC2 and direct uploads.
- Migrating files between projects or directories.

## Scope & match rule

- **Source of truth:** `project_files` joined to `projects where archived = false`.
- **Match:** `basename(dropbox_path)` matches `^(\d{13})-(\d+)-(.+)$` → strip groups 1+2, keep group 3.
- **Skip:** rows where `dropbox_path` is null or basename does not match.
- **DB update:** only `project_files.dropbox_path`. `filename` is left alone.
- **Reconcile pass:** for each active project's `/uploads/` directory, list once during planning. Any prefixed file in Dropbox with no matching DB row is reported as an orphan in `<plan>.orphans.json` and never moved.

## CLI

A single TypeScript entry point with two subcommands.

### Plan

```
pnpm tsx scripts/reconcile-active-filenames.ts plan \
  --out tmp/reconcile-<timestamp>.plan.json \
  [--limit N]
```

Behaviour:

1. Query active projects + their `project_files` rows.
2. For each active project, call `filesListFolder` once on its `/uploads/` directory (paginated). Cache the listing.
3. For each matching DB row, compute the target path (strip prefix, then resolve collisions — see below).
4. Write three sibling files:
   - `<plan>.json` — array of `PlanRow`.
   - `<plan>.orphans.json` — array of `OrphanRow` (Dropbox files with prefix but no DB row).
   - `<plan>.errors.json` — array of `ErrorRow` (project dirs that failed to list).
5. Print summary: `N projects scanned, M files planned, K conflicts resolved with suffix, O orphans, E project-list errors`.

`--limit N` truncates planned rows after collision resolution (used for smoke tests).

### Apply

```
pnpm tsx scripts/reconcile-active-filenames.ts apply \
  --plan tmp/reconcile-<timestamp>.plan.json \
  [--concurrency 4] \
  [--limit N]
```

Behaviour:

1. Read `<plan>.json` and (if present) `<plan>.progress.json`.
2. For each `PlanRow`:
   - If `progress[fileId].db_done === true` → skip.
   - Else: `filesMoveV2({ from_path: dropboxFileId ? \`id:${dropboxFileId}\` : fromPath, to_path: toPath, autorename: false })`. Using the `id:` form means the move succeeds even if the source path drifted between plan and apply.
   - On success → set `progress[fileId] = { dropbox_done: true, newPath }` → `update project_files set dropbox_path = $1 where id = $2` → set `db_done: true`.
   - On error → record `progress[fileId].error = <classified-message>`, continue.
3. Concurrency pool (default 4, configurable). Progress file writes are serialized through a single async mutex so concurrent workers do not corrupt the JSON file; flushed to disk after every row update.
4. Final summary: `success / skipped / error` counts + path to progress file.

`--limit N` processes only the first N rows of the plan (for smoke tests).

## Collision suffix algorithm

Per `/uploads/` directory, build `taken: Set<string>` from:

1. Current Dropbox listing of that dir (cached during plan).
2. Other planned `toPath` values targeting the same dir.

For each candidate target name `name.ext`:

- If not in `taken` → use as-is, add to `taken`.
- Else try `name-2.ext`, `name-3.ext`, … until free. Add to `taken`.

Suffix inserted before the **last** dot. Files with no extension get a bare `-N` appended. Files with multiple dots (`foo.tar.gz`) become `foo.tar-2.gz` — acceptable.

## Error handling & logging

### Plan phase

| Failure | Behaviour |
|---|---|
| `filesListFolder` failure for a project dir | Record `{ projectId, error }` in `<plan>.errors.json`; exclude that project's rows from the plan; continue. |
| DB query failure | Abort. Nothing partial to clean up. |

### Apply phase

| Failure | Behaviour |
|---|---|
| `dropbox_not_found` (file gone) | Mark row `skipped`; continue. |
| `dropbox_conflict` (target exists despite plan — race) | Re-resolve suffix on the fly; retry once. |
| `dropbox_rate_limited` (429) | Honour `Retry-After`; retry up to 3×. |
| Other Dropbox error | Mark row `error: <msg>`; continue. |
| DB update failure after successful Dropbox move | `dropbox_done = true, db_done = false`; log loudly. Resume picks it up. |

Logging: pino-style JSON line per op to stdout; final human-readable summary to stderr.

## Data structures

```ts
type PlanRow = {
  fileId: string;          // project_files.id — also the progress key
  projectId: string;
  dropboxFileId: string | null;
  fromPath: string;
  toPath: string;
};

type OrphanRow = {
  projectId: string;
  path: string;
  basename: string;
};

type ErrorRow = {
  projectId: string;
  error: string;
};

type ProgressRow = {
  dropbox_done: boolean;
  db_done: boolean;
  newPath?: string;
  error?: string;
};

type ProgressFile = Record<string, ProgressRow>; // keyed by PlanRow.fileId
```

## File layout

```
scripts/
  reconcile-active-filenames.ts        # CLI entry
lib/reconcile-filenames/
  plan.ts                              # buildPlan({ db, dropbox, limit })
  apply.ts                             # applyPlan({ plan, progress, dropbox, db, concurrency, limit })
  strip.ts                             # stripPrefix(name), resolveCollision(target, taken)
  types.ts                             # PlanRow, ProgressRow, OrphanRow, ErrorRow
tests/unit/
  reconcile-strip.test.ts
  reconcile-plan.test.ts
tests/integration/
  reconcile-apply.test.ts
```

Reuses `lib/storage/dropbox-adapter.ts`. Add thin wrappers if needed: `listFolder(path)` and `moveFile({ from, to, autorename })`.

## Testing

### Unit (vitest)

- `stripPrefix(basename)` — match / non-match table (timestamp-only, two-prefix, no-prefix, edge characters).
- `resolveCollision(target, taken)` — empty set, single collision, multi-collision, multi-dot extension, no-extension.
- Plan builder — given mock DB rows + mock Dropbox listings, asserts expected plan + orphans + conflict suffixes.

### Integration (vitest + mocked Dropbox adapter)

- Apply happy path (move + db update both succeed).
- Resume after partial failure (`db_done = false` is retried; `db_done = true` is skipped).
- Dropbox `not_found` → row marked `skipped`.
- Dropbox 429 with `Retry-After` → retried up to 3×.
- Conflict-on-apply triggers re-suffix and retries once.
- DB-only via existing `tests/utils/pg.ts` helpers.

### Manual smoke

1. Run `plan` against staging Dropbox + dev DB; review `<plan>.json` and `<plan>.orphans.json`.
2. Run `apply --limit 5` on the resulting plan; spot-check Dropbox + DB.
3. Re-run `apply` to confirm it skips completed rows.

## Open questions

None at spec-write time.

## Out of scope follow-ups

- Strip the single-prefix `^\d{13}-` form on direct-upload files.
- Backfill archived projects.
- Reconcile orphans flagged in `<plan>.orphans.json`.
