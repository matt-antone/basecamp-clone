# BC2 Title Anomaly Scan — Design

**Date:** 2026-05-04
**Status:** Draft
**Owner:** Matthew Antone

## Problem

`scripts/migrate-bc2.ts` derives a lot of structured data (`code`, `num`, `title`, `project_code`, `project_seq`, slug, Dropbox folder name) from a single human-entered BC2 project title. The parser in `lib/imports/bc2-transformer.ts` has two regex tiers:

```
PRIMARY:  /^([A-Za-z]+)-(\d{3,4}):\s*(.+)$/
FALLBACK: /^([A-Za-z]+)\s*[-–]\s*(.+)$/
```

Anything that fails PRIMARY but matches FALLBACK loses `num`, which causes `migrate-bc2.ts` to assign `next_seq` from the DB. Concrete failure mode: `GX-0042b` (variant project) → FALLBACK match → `num=null` → migrator generates `GX-0043` → real `GX-0043` then collides → cascade.

We do not yet know the full taxonomy of anomalies in the BC2 corpus. Before we touch the migrator, we need a one-shot diagnostic that classifies every BC2 project title.

## Goal

Identify and classify anomalous BC2 project titles. **Identify only.** Remediation, parser changes, and migrator fixes are out of scope.

## Non-Goals

- No suggested-fix output (e.g., proposing canonical `num` for variant projects)
- No DB writes
- No changes to `parseProjectTitle` or `migrate-bc2.ts`
- No interactive triage UI
- No retry/resume — diagnostic is one-shot, rerun on failure

## Architecture

Two scripts plus one pure module. Title-only — no messages, comments, files, or attachments.

```
scripts/
  dump-bc2-titles.ts       # fetch BC2 → tmp/bc2-titles.json
  audit-bc2-titles.ts      # read JSON → classify → write CSV + JSON
lib/imports/
  bc2-title-classifier.ts  # pure: classifyTitle(raw) → Classification
tests/unit/
  bc2-title-classifier.test.ts
tmp/                       # gitignored
  bc2-titles.json
  bc2-title-audit.csv
  bc2-title-audit.json
```

**Separation of concerns:**

- `dump-bc2-titles.ts` does network IO only. Reuses `Bc2Fetcher.fetchProjects({ source })` from `lib/imports/bc2-fetcher.ts`. Projects each record to `{ id, name, status, archived, created_at }`. Writes atomically (`tmp/bc2-titles.json.tmp` → rename).
- `bc2-title-classifier.ts` is pure. No `lib/db`, no network, no fs. Lets the classifier be re-run 50× on the cached dump while iterating on rules.
- `audit-bc2-titles.ts` reads dump, calls classifier per row, runs cross-row duplicate detection, writes CSV + JSON, prints a stdout summary.

## Classification Rules

Each title gets one **primary class** + zero or more **flags**.

### Primary class

Rules are evaluated in table order. **First true rule sets the primary class** — no row gets two primary classes.

| Class | Test | Example |
|---|---|---|
| `empty-raw` | input is null/undefined/whitespace-only | `""` |
| `empty-title` | matches PRIMARY but captured title is whitespace-only | `GX-0042:` |
| `clean` | matches PRIMARY AND num is 4 digits AND title non-empty | `GX-0042: Brand refresh` |
| `clean-3digit-num` | matches PRIMARY AND num is 3 digits | `GX-042: Brand refresh` |
| `suffixed-num` | matches `^[A-Za-z]+-\d+[A-Za-z]+(:|\s|$)` (cascade bug) | `GX-0042b: Variant` |
| `short-num` | matches `^[A-Za-z]+-\d{1,2}(:|\s|$)` | `GX-12: Foo` |
| `long-num` | matches `^[A-Za-z]+-\d{5,}(:|\s|$)` | `GX-12345: Foo` |
| `missing-colon` | matches `^[A-Za-z]+-\d{3,4}\s+\S` (no colon after num) | `GX-0042 Foo` |
| `prefix-noise` | not start-anchored, but `\b[A-Za-z]+-\d{3,4}(:|\s)` appears anywhere after position 0 | `[ARCHIVED] GX-0042: Foo` |
| `fallback-no-num` | matches FALLBACK only, no digits in code segment | `GX - Foo` |
| `no-code` | none of the above; no leading `[A-Za-z]+` followed by `-`/`–` | `Foo Bar Project` |

### Flags (any combination)

- `lowercase-code` — code is not all-caps
- `en-dash-separator` — uses `–` instead of `-`
- `non-ascii` — title contains non-ASCII chars
- `leading-trailing-ws` — `raw !== raw.trim()`
- `colon-in-title` — title contains `:` (potential second code)
- `unknown-client-code` — code not in known set (audit script injects from `clients` table when `--clients-from-db` is passed; off by default)
- `duplicate-code-num` — another row shares same `(code, num)` (cross-row, set by audit script after classification pass)

A `clean` title with zero flags is the gold path. Anything else surfaces in the report.

### Best-effort extraction for non-clean rows

For any non-clean classification, the classifier still returns `code`, `num`, `parsed_title` on a best-effort basis (e.g., for `suffixed-num`, `code=GX`, `num=0042b`, `parsed_title="Variant"`). Helps eyeball remediation.

## Data Flow

```
BC2 API ──► dump-bc2-titles.ts ──► tmp/bc2-titles.json
                                       │
                                       ▼
                              audit-bc2-titles.ts
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
    bc2-title-classifier      duplicate detection        format writers
    (per-row, pure)           (cross-row by code|num)    (CSV + JSON)
                                       │
                                       ▼
                          tmp/bc2-title-audit.csv
                          tmp/bc2-title-audit.json
                          stdout summary
```

## Output Formats

### CSV — `tmp/bc2-title-audit.csv`

One row per project, sortable in spreadsheets:

```
bc2_id, raw_title, primary_class, flags, code, num, parsed_title, archived, status, created_at
12345, "GX-0042b: Variant brand refresh", suffixed-num, "lowercase-code", GX, 0042b, "Variant brand refresh", false, active, 2024-08-12
67890, "GX-0042: Brand refresh",          clean,        "",                GX, 0042,  "Brand refresh",          false, active, 2023-11-02
```

`flags` is a `;`-separated list inside one CSV cell so spreadsheet filtering works.

### JSON — `tmp/bc2-title-audit.json`

Same data grouped for scripted follow-up:

```json
{
  "generated_at": "2026-05-04T18:30:00Z",
  "total": 412,
  "counts": { "clean": 287, "suffixed-num": 14, "missing-colon": 8 },
  "by_class": {
    "suffixed-num": [
      {
        "bc2_id": 12345,
        "raw_title": "GX-0042b: ...",
        "code": "GX",
        "num": "0042b",
        "parsed_title": "...",
        "flags": ["lowercase-code"],
        "archived": false,
        "status": "active",
        "created_at": "2024-08-12T..."
      }
    ]
  },
  "duplicates": [
    {
      "code": "GX",
      "num": "0042",
      "bc2_ids": [12345, 67891],
      "raw_titles": ["...", "..."]
    }
  ]
}
```

### Stdout summary

- Total rows processed
- Count per primary class (sorted desc, `clean` first)
- Top 10 anomalies per non-clean class (raw title only)
- File paths written

## CLI

### `dump-bc2-titles.ts`

```
npx tsx scripts/dump-bc2-titles.ts [--source=active|archived|all] [--out=path]
```

- `--source` defaults to `all` (full picture; surface latent bombs in archived projects)
- `--out` defaults to `tmp/bc2-titles.json`
- Reads BC2 credentials from `.env.local` via the existing `requireEnv` pattern from `migrate-bc2.ts`

### `audit-bc2-titles.ts`

```
npx tsx scripts/audit-bc2-titles.ts [--in=path] [--out-csv=path] [--out-json=path] [--clients-from-db]
```

- `--in` defaults to `tmp/bc2-titles.json`
- `--out-csv` defaults to `tmp/bc2-title-audit.csv`
- `--out-json` defaults to `tmp/bc2-title-audit.json`
- `--clients-from-db` enables `unknown-client-code` flag by querying `clients` table; off by default so audit runs with zero DB access

## Error Handling

**Dump script:**

- BC2 API failure → exit non-zero, print which page failed; partial dump file NOT written (atomic temp + rename)
- Auth/env missing → fail fast with `requireEnv`
- Each record validated: `id` is number, `name` is string. Skip + warn on malformed; count surfaced in summary

**Classifier:**

- Pure function. Null/undefined/whitespace input → `empty-raw` class, no flags
- Never throws

**Audit script:**

- Missing dump file → fail with hint to run `dump-bc2-titles.ts` first
- Duplicate detection bucket: `${code}|${num}`, after classification. Skips rows where code or num is null
- `--clients-from-db` only: connection failure → warn, continue without `unknown-client-code` flag (don't fail audit over an optional flag)

## Testing

`tests/unit/bc2-title-classifier.test.ts`:

- Fixture list of ~25 representative titles. Each fixture: `{ raw, expectedClass, expectedFlags, expectedCode, expectedNum, expectedTitle }`
- One test per primary class
- One test per flag (in isolation and stacked)
- **Drift guard test:** for every fixture marked `clean`, assert `parseProjectTitle(raw)` returns non-null `code` and `num` matching expected. Catches divergence if either regex changes.

No tests for `dump-bc2-titles.ts` or `audit-bc2-titles.ts` themselves — they are thin IO wrappers around the tested classifier and the already-tested `Bc2Fetcher`.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Classifier regex drifts from `parseProjectTitle` regex | Drift guard test asserts `clean`-class fixtures parse successfully via real parser |
| BC2 dump becomes stale during long triage | Dump file is named with no timestamp; user reruns dump when needed. Optional: add `generated_at` to dump file (cheap to add) |
| Anomaly classes we haven't anticipated | Classifier returns `no-code` as catch-all; review the top-10 of `no-code` class for new patterns to promote into named classes |
| `--clients-from-db` flag couples audit to DB | Off by default. Audit runs without it. |

## Out-of-Scope Follow-Ups

After audit results land, separate spec(s) will address:

1. Migrator behavior for `suffixed-num` (variant projects) — preserve suffix in `project_code` instead of re-sequencing
2. Updates to `parseProjectTitle` regex if audit reveals common patterns currently misclassified
3. Manual remediation list for any irreparable titles
