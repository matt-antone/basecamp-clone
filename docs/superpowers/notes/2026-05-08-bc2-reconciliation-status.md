# BC2 Migration + Reconciliation — Status

**Date:** 2026-05-08
**Owner:** Matt
**Purpose:** Single source of truth for migration + reconciliation work so a future session can pick up without re-deriving context.

---

## Migration (DONE — merged)

**PR:** [#34](https://github.com/matt-antone/2026-04/basecamp-clone/pull/34) — `feat/migrate-from-dump` → main, merged 2026-05-07.

**Result of full migration run** (post-merge, run from main checkout):

| Bucket | Count |
| --- | --- |
| Successful imports (`null` message) | 53,088 |
| Already-mapped re-run hits | 3,674 |
| Skipped-existing files (re-run hits) | 2,053 |
| Orphan projects (no client match) | 17 |
| `CalendarEvent` skipped | 94 |
| `Todo` skipped | 40 |
| File "Failed to parse URL from undefined" | 44 |
| Transient errors (fetch fail / 409 / connection terminated) | 17 |

**Hard constraint going forward:** the full migration is not run again. Reconciliation tools must operate on a precisely identified subset of records (driven by the audit CSVs) and never invoke `scripts/migrate-from-dump.ts` against the broader dataset. Targeted helpers OK; full-phase orchestration not.

---

## Audit (DONE — branch ready, PR not opened)

**Branch:** `feat/audit-bc2-dump` on origin
**PR URL (open manually):** https://github.com/matt-antone/basecamp-clone/pull/new/feat/audit-bc2-dump

**Spec:** `docs/superpowers/specs/2026-05-08-audit-bc2-dump-design.md`
**Plan:** `docs/superpowers/plans/2026-05-08-audit-bc2-dump.md`

**What it does:** read-only diff of the BC2 dump (`/Volumes/Spare/basecamp-dump/`) against `import_map_*` and `import_logs`. Writes per-entity CSVs to `tmp/audit/`. No DB writes, no BC2 API calls.

**Files added (8 commits on the branch):**

```
.gitignore                              # tmp/ ignored
lib/imports/audit/types.ts
lib/imports/audit/csv-writer.ts
lib/imports/audit/reader.ts
lib/imports/audit/diff.ts
scripts/audit-bc2-dump.ts
tests/unit/audit-csv-writer.test.ts
tests/unit/audit-reader.test.ts
tests/unit/audit-diff.test.ts
```

Plus `package.json` script: `pnpm audit:bc2-dump`.

**Latest audit run summary:**

```
entity      expected  mapped  accounted_skip  accounted_fail  unaccounted
people      8         8       0               0               0
projects    3691      3674    0               17              0
topics      25575     25321   134             0               120
comments    12164     11353   0               0               811
files       30013     29812   0               60              141
```

People + projects are 100% accounted-for (the 17 project failures are the known orphans). Topics, comments, and files have unaccounted-for rows that the audit identified concretely.

---

## Reconciliation (NEXT — 3 sub-projects, not yet specced)

The audit pinpointed three independent reconciliation buckets. Each gets its own spec → plan → implementation cycle.

### 1. Missed-phase projects (highest record gain)

**Pattern**: 17 specific projects had their **threads + files phases never run** despite being mapped in `import_map_projects`. Likely cause: pre-patch EADDRNOTAVAIL crash mid-run; the post-patch re-run did not re-process them. Each affected project is 100% missing (not partial).

**Specific project IDs** (BC2 IDs):

Missing threads (16 projects, 120 topics):
```
12836341  (36 topics)
12859408  (17)
18186485  (17)
18681846  (14)
17004712  (11)
14312106  (5)
14107635  (3)
17490625  (3)
19336775  (3)
19770284  (3)
14049017  (2)
18049673  (2)
12449980  (1)
12450413  (1)
13663293  (1)
[16th id — re-extract from tmp/audit/topics.csv when needed]
```

Missing files (11 projects, 141 files):
```
12836341  (39 files)
12859408  (24)
18681846  (18)
18186485  (16)
17004712  (13)
12449980  (11)
14312106  (8)
15081406  (7)   ← only project missing files but NOT topics
17490625  (2)
18049673  (2)
19770284  (1)
```

10 of 11 file-missing projects overlap with the topic-missing list. 1 new project (`15081406`).

**Comment cascade**: ~811 comments missing, almost entirely children of the 120 missing topics + the 134 accounted-skip topics (Calendar/Todo). When a parent topic is skipped or missed, its comments are never iterated.

**Proposed scope of Spec 2**: a `scripts/reconcile-missed-projects.ts` that takes a hard-coded list of project IDs (sourced from this audit) and runs the existing `migrateThreadsAndComments` + `migrateFiles` phase modules **for those IDs only**. Reuses idempotency guards already present in the phase modules. Does not invoke `scripts/migrate-from-dump.ts`.

### 2. Orphan projects

**Pattern**: 17 BC2 projects whose name does not match any known client code, so the migration's `resolveTitle` step returned `matchedBy: "none"` and the project failed at the `import_map_projects` stage.

**Specific orphan titles** (from initial migration audit CSV):

```
Huntsman: Email Change
Alliance Business Solutions
Levato (SummitLA) Website
MediaTemple Server Upgrade
Falconvision.com updates
24 Hr HomeCare: 001-Book Jacket/Bookmark
Website Template
Freeborn Proposal
Legacy Notes
Match My Sound Info
Avivo Domain Names
Cynthia Cohn (Realtor) Information
Dr. Richard Onofrio Foundation Letterhead
Levato (Summit LA) Logo & Stationery Package
Theater D
R2LG-003: Training w/Matt
New Nemecek Logo On Site
```

**Proposed scope of Spec 3**: operator-driven mapping — for each orphan, decide: assign to existing client, create new client, or accept skip. A small CLI script reads the per-project decision file (e.g., a YAML or CSV of `{bc2_id: ..., action: assign|create|skip, client_code?: ...}`) and applies it via direct SQL or single-project helper. Pull authoritative ID list from `tmp/audit/projects.csv` filtered to `status=failed`.

### 3. File URL parse failures

**Pattern**: 44 file rows in BC2 attachments where the `url` field was missing or undefined, so `Failed to parse URL from undefined` fired during the BC2 download step. These could be:
- BC2 attachment placeholders without a fetchable binary
- Dump-script edge case where the URL wasn't preserved in JSON
- Attachments referenced by a comment but no longer hosted by BC2

**Proposed scope of Spec 4**: investigate the dump JSON for the 44 specific attachment IDs (pull from `tmp/audit/files.csv` filtered to `status=failed` AND `reason='Failed to parse URL from undefined'`). Determine whether the URLs are recoverable, the attachments are truly orphaned, or whether a dump-script re-run for those projects can re-pull metadata. May result in code change to dump-bc2.ts or simply documented loss.

---

## Pending follow-ups (non-blocking, deferred from prior reviews)

These were flagged during code review on the migration branch but not blocking merge:

- `migrateProjects` doesn't surface `failed` count in its return type (only `migrated[]`). Console summary line under-reports project failures vs. `import_logs`.
- Threads phase passes no-op `logRecord`/`incrementCounters` to `importBc2FileFromAttachment` (when handling file attachments embedded in comments). Helper-internal logs are silently swallowed.
- Files phase lumps `resolveBc2AttachmentLinkage` failure with upload failure under a single `failed` bucket. Distinguish later if useful.
- Integration test cleanup truncates `import_logs` / `import_jobs` (acceptable on test DB only — flagged for awareness).

---

## Worktrees + branches

| Path | Branch | Status |
| --- | --- | --- |
| (main checkout) | `main` | in sync with origin/main, includes merged migrate-from-dump |
| `.worktrees/migrate-from-dump` | `feat/migrate-from-dump` | merged via PR #34 — can be removed |
| `.worktrees/audit-bc2-dump` | `feat/audit-bc2-dump` | pushed, PR not opened |
| `.worktrees/reconcile-prod-to-test` | `reconcile-prod-to-test` | unrelated earlier work — not part of this thread |

---

## Quick commands for the next session

```bash
# Run audit again (read-only, against current DB)
pnpm audit:bc2-dump
ls -lh tmp/audit/
head tmp/audit/summary.csv

# Pull orphan project IDs
awk -F',' 'NR>1 && $4=="failed"' tmp/audit/projects.csv

# Pull missed-phase project IDs (those with status=missing in topics)
awk -F',' 'NR>1 && $5=="missing"' tmp/audit/topics.csv | cut -d, -f1 | sort -u

# Pull file-URL-bug attachment IDs
awk -F',' 'NR>1 && $5=="failed" && $7 ~ /Failed to parse URL/' tmp/audit/files.csv

# Inspect a specific BC2 project's dump
ls /Volumes/Spare/basecamp-dump/by-project/12836341/
```

---

## Key invariants to preserve

1. **Never run the full migration again.** Targeted reconciliation only.
2. **Audit is read-only.** Re-runable any time without risk.
3. **Calendar + Todo permanently skipped** — not in scope for any reconciliation work.
4. `import_map_*` is the source of truth for what was imported. `import_logs.data_source` distinguishes dump vs. api source per record.
5. Dump at `/Volumes/Spare/basecamp-dump/` is canonical and immutable.
