# BC2 Import Remediation — Design

**Date:** 2026-05-04
**Status:** Draft
**Owner:** Matthew Antone
**Predecessor:** `docs/superpowers/specs/2026-05-04-bc2-title-anomaly-scan-design.md` (audit) — produced findings that motivate this work

## Problem

The first BC2 → Supabase + Dropbox import run produced cascade failures driven by anomalous human-entered project titles. The audit (3691 BC2 projects classified) surfaced five concrete bug classes plus one schema constraint that turn this from "rare edge case" into "247+ rows mis-imported."

### Findings driving this remediation

| Class | Count | Root cause |
|---|---|---|
| `prefix-noise` | 121 | Compound client codes (`Cal-LPF-003`, `Get Dismissed-022`) tokenize wrong — parser captures only first `[A-Za-z]+` |
| `fallback-no-num` | 126 | Same compound-code issue — FALLBACK regex splits at first `-` |
| `suffixed-num` | 49 | Variant projects (`MMR-049A`, `JFLA-188a`) — `parseInt("0042b")` coerces to `42`, collides with `0042` |
| `missing-colon` | 45 | `POMS-1511 Scissor Lift...` (no `:` after num) — fails PRIMARY regex |
| `short-num` | 18 | `Union-13`, `HFLS-20` — fewer than 3 digits, fails PRIMARY regex |
| `no-code` | 108 | Projects without identifiable code; `project_code NOT NULL` blocks them |
| Duplicates | 60 groups (120 rows) | Same `(code, num)` reused for multiple BC2 projects |

Independent client-name normalization probe shows **237 of 247** prefix-noise + fallback-no-num rows recover via normalized `clients.code` lookup. Of remaining no-code rows, **61 of 108** start with a known client code/name.

## Goals

1. Make the BC2 → local migration produce correct, non-cascading data on a re-run with the existing 3691-row corpus
2. Allow projects without `project_code` (per existing null-safe read paths)
3. Preserve series suffixes (`A`, `b`) as full identity, not collide with base num
4. Disambiguate duplicate `(code, num)` groups deterministically
5. Run the full pipeline against an isolated Supabase project + Dropbox sandbox folder for end-to-end verification before touching production

## Non-Goals

- No new admin UI for client/code reassignment (follow-up if needed)
- No automated typo-merge for near-duplicate titles (`Steril-Aire-085: E-blast #15` vs `Eblast #15`) — they migrate as separate suffixed projects, manual merge can happen later in-app
- No changes to thread/comment/file import logic — only project identity layer
- No changes to BC2 fetcher or BC2 client modules
- No changes to the audit/classifier modules — they remain diagnostic-only

## Architecture

Five coupled work items, single PR, single migration run target. Bundled because they all converge on the same import boundary; reviewing in isolation invites integration bugs.

```
lib/imports/
  bc2-transformer.ts        # MODIFY: parser regex relax (missing-colon, short-num, suffixed-num)
  bc2-client-resolver.ts    # CREATE: pure normalized client lookup module
scripts/
  migrate-bc2.ts            # MODIFY: code-less path, dup disambig, resolver wiring
  seed-clients-from-prod.ts # CREATE: seed test DB clients from production export
supabase/migrations/
  NNNN_relax_project_code_not_null.sql  # CREATE: drop NOT NULL, verify unique index NULL semantics
tests/unit/
  bc2-client-resolver.test.ts  # CREATE
  bc2-transformer.test.ts      # MODIFY: add fixtures for new parser cases
```

## Component-by-Component Design

### 1. Parser regex relax (`lib/imports/bc2-transformer.ts`)

Replace `parseProjectTitle` with three-tier matching that subsumes today's PRIMARY/FALLBACK plus the new cases.

```ts
// Allow:
//   - num as 1–5 digits (was 3–4): handles short-num + long-num
//   - optional letter suffix on num: preserves variants
//   - separator after num is `:` OR whitespace: handles missing-colon
//   - 4 -> 3 -> 1+ digit precedence preserved by greediness
const EXTENDED = /^([A-Za-z]+)-(\d{1,5}[A-Za-z]*)\s*[:\s]\s*(.+)$/;
const FALLBACK = /^([A-Za-z]+)\s*[-–]\s*(.+)$/;  // unchanged
```

`parseProjectTitle` returns `{ code, num, title }` where `num` is now `string | null` and may include a letter suffix (e.g., `"0042b"`). Downstream callers must treat `num` as opaque string — never `parseInt` it for identity comparison.

**Impact on existing call sites:**

- `migrate-bc2.ts:257` currently does `projectSeq = parseInt(num, 10)` for `project_seq`. This is fine for sequence numbering since variants share the integer prefix (`0042b → 42`); the unique identity is in `project_code` which keeps the full `0042b` string.
- All other callers consume the parsed `title` only.

**Test fixtures added** to `tests/unit/bc2-transformer.test.ts`:

- `POMS-1511 Scissor Lift Certificates` → `{code:"POMS", num:"1511", title:"Scissor Lift Certificates"}`
- `Union-13: KubeCon Video Re-edit` → `{code:"Union", num:"13", title:"KubeCon Video Re-edit"}`
- `MMR-049A: Images...` → `{code:"MMR", num:"049A", title:"Images..."}`
- `GX-12345: Foo` → `{code:"GX", num:"12345", title:"Foo"}` (long-num)
- All existing fixtures remain green

### 2. Client resolver (`lib/imports/bc2-client-resolver.ts`)

Pure module. No DB calls (caller injects known clients). Accepts:

```ts
interface KnownClient { id: string; code: string; name: string; }

interface ResolvedTitle {
  clientId: string | null;       // null when no match (caller decides what to do)
  matchedBy: "code" | "name" | "auto-create-pending" | "none";
  code: string | null;            // canonical client code from DB if matched, else extracted from title
  num: string | null;             // including letter suffix
  title: string;                   // remaining non-prefix text
  confidence: "high" | "medium" | "low";
}

export function resolveTitle(rawTitle: string, knownClients: KnownClient[]): ResolvedTitle;
```

**Algorithm:**

```
1. Build normalization index from knownClients:
   normalize(s) = s.toLowerCase().replace(/[\s\-_.]/g, "")
   For each client, index BOTH normalize(code) AND normalize(name) → client.

2. Take leading run of trimmed title up to first `:` or first sequence of `\d+[A-Za-z]*` boundary.
   Normalize that lead.

3. Try longest-prefix match against the normalization index (longest known key first).
   On match → matchedBy="code"|"name"; clientId = matched client.id;
   code = matched client.code (canonical, NOT the title's representation);
   parse remainder for num + title.

4. On miss → fall back to parseProjectTitle. If parser returns code+num,
   matchedBy="auto-create-pending", clientId=null, confidence="medium",
   code = parser code, num = parser num.
   (Caller decides whether to auto-create a client record.)

5. On total miss (parser returns no code) → matchedBy="none", clientId=null,
   confidence="low", code=null, num=null, title=raw.
```

**Confidence levels:**

- **high:** matched by code (`Cal-LPF` → `CalLPF`) or by name with num (`Merrill Lynch-001`)
- **medium:** matched by name without num (`Bird Marella - Website Updates`); or `auto-create-pending` cases (clean parse, unknown prefix)
- **low:** no client identifiable

**Word-boundary refinement:** Substring contains-only matches (the noisy bucket from research probe — `"GX Capabilities"` matching `"ABI"`) are NOT used. Only longest-prefix-of-normalized-lead. This avoids the false positives.

### 3. Migrator changes (`scripts/migrate-bc2.ts`)

Three intertwined changes around lines 195–315 (the `runProjectsImport` function).

#### 3a. Pre-fetch known clients once

Before the per-project loop, query `select id, code, name from clients` into a `KnownClient[]`. Pass to `resolveTitle` calls. Single query, no per-row DB hit.

#### 3b. Per-project resolution

Replace `parseProjectTitle` call with `resolveTitle`. Branch on `matchedBy`:

| `matchedBy` | Action |
|---|---|
| `code`, `name` (with num) | Use resolved clientId. `project_code = ${client.code}-${num}`. Standard path. |
| `name` (no num) | Use resolved clientId. `project_code = NULL`. Slug = `slugify(title) + "-bc2_" + bc2_id`. |
| `auto-create-pending` (clean prefix + num parse, no client match) | Auto-create new client. `code = prefix.replace(/[\s\-_.]/g, "")` (e.g., `"Merrill Lynch"` → `"MerrillLynch"`). `name = prefix.trim()` (e.g., `"Merrill Lynch"` as-typed). Use new client. Standard path. Auto-created client logged to `bc2-import-summary.json` for post-migration review. |
| `none` (no code, no client name in title) | If `--allow-orphans` flag passed, insert with `client_id=NULL, project_code=NULL`. Otherwise, skip and emit to `tmp/bc2-import-orphans.csv` for manual triage. Default: skip. |

#### 3c. Suffixed-num path

When `num` from resolver contains a letter suffix (matches `/^\d+[A-Za-z]+$/`):

- `project_code = ${client.code}-${num}` (full string including suffix)
- `project_seq = parseInt(num.match(/^\d+/)[0], 10)` — integer prefix only
- Variants share `project_seq` but have distinct `project_code` (the unique index allows this since `(client_id, project_seq)` is the seq uniqueness constraint and `project_code` uniqueness uses the full string)

#### 3d. Duplicate disambiguation pre-pass

Before the per-project loop:

```ts
// Group BC2 projects by canonical (clientId, num) pre-resolved.
// First-by-created_at keeps bare code; subsequent get a/b/c suffix.
function planDupSuffixes(resolvedProjects: ResolvedProject[]): Map<string, string> {
  // returns bc2Id -> assigned suffix ("" for bare, "a"/"b"/"c"/... for dups)
}
```

For each duplicate group:

1. Sort by BC2 `created_at` ASC
2. First entry: `assignedSuffix = ""`
3. Second entry: `"a"`, third: `"b"`, etc.
4. If group size > 26: emit warning, fall back to `"a${n-1}"` (e.g., `a2`, `a3`)

The migrator then uses `project_code = ${client.code}-${num}${assignedSuffix}` when constructing the row.

**Edge case (out-of-scope per Q4b confirmation):** if a future dataset has a base num that already collides with an existing suffixed-num variant (e.g., dup group `MMR-049` while `MMR-049A` already exists from a separate variant project), the migrator will throw on unique-index conflict. This case is documented but not handled — re-run with manual fix to the dataset would resolve.

### 4. Schema migration (`supabase/migrations/NNNN_relax_project_identity_constraints.sql`)

The existing `0005_project_identity_and_storage.sql` enforces `NOT NULL` on five identity columns and a `UNIQUE (client_id, project_seq)` index. Both block our remediation needs.

```sql
-- Allow projects without an assigned identity (no-code path).
-- Reads already null-safe in lib/repositories.ts (6 call sites use coalesce / null checks).
alter table projects
  alter column project_code drop not null,
  alter column project_seq drop not null,
  alter column client_slug drop not null,
  alter column project_slug drop not null,
  alter column storage_project_dir drop not null;

-- Drop the (client_id, project_seq) unique constraint.
-- Reason: variant projects (MMR-049A, MMR-049B, ...) intentionally share project_seq=49.
-- The existing idx_projects_project_code_unique on project_code remains as the real identity guard.
drop index if exists idx_projects_client_seq_unique;

-- Postgres default unique-index semantics treat NULLs as distinct, so
-- multiple NULL project_codes are allowed without explicit NULLS DISTINCT clause.
-- (Verified: 0005 migration created idx_projects_project_code_unique without NULLS NOT DISTINCT.)
```

**Implication for variants:** with the seq-uniqueness constraint gone, `MMR-049A`, `MMR-049B`, etc. can all hold `project_seq = 49` (the integer prefix of the num). `project_code` distinguishes them. The seq column becomes informational (used for sort order, breadcrumbs) rather than an identity component.

### 5. Test-environment bootstrap

Done before the migration run, not part of the production deploy.

**Test project already provisioned:** Supabase project `anrnlmmanhrddkvrnooe` exists. Supabase MCP server registered in `.mcp.json` (project-scoped) for direct schema/data tooling from Claude Code.

#### 5a. Capture connection string

From the Supabase dashboard for project `anrnlmmanhrddkvrnooe`:

- Copy the pooled connection string (or direct, depending on which the migrator's `pg.Pool` prefers — direct is typical)
- Workflow option: keep two env files — `.env.local` (production) and `.env.test.local` (test project). Swap the active file by symlink or by `cp` before runs. Reduces risk of accidentally pointing the migrator at production.
- Alternative: a single `.env.local` with commented production URL while testing. Less safe but simpler.

#### 5b. Apply existing migrations + the new identity-relax migration

Two paths:

- **Preferred (MCP-driven):** use `mcp__supabase__apply_migration` (or whatever the Supabase MCP exposes for schema work). One call per migration file in `supabase/migrations/` order. Visible in this session, scriptable, no shell tooling required.
- **CLI fallback:** `supabase db push --db-url <test-url>` if the Supabase CLI is set up locally. Requires linking the project once.

End state: test DB schema matches production schema **plus** the new `NNNN_relax_project_identity_constraints.sql`.

#### 5c. Seed clients from production

`scripts/seed-clients-from-prod.ts` — reads `clients` table from production via env var `PROD_DATABASE_URL`, writes to test DB via `DATABASE_URL`. Idempotent (skip if code exists). 125 rows.

```
npx tsx scripts/seed-clients-from-prod.ts
```

Required so the resolver has the 125 known client codes/names available; otherwise resolver whiffs and migrator falls into auto-create-pending for all 247 compound-code rows.

Alternative if `PROD_DATABASE_URL` access is not available locally: dump `clients` to a JSON file from production (or via Supabase MCP if production also has an MCP), and have the seed script read from JSON instead of from a live DB. Safer (no production credentials in test env) but adds one manual step.

#### 5d. Dropbox sandbox folder

User sets `DROPBOX_PROJECTS_ROOT_FOLDER=/Projects-test` (or similar) in `.env.test.local` before running migrator. Production folder untouched.

#### 5e. Run migrator

```
npx tsx scripts/migrate-bc2.ts --mode=full --files
```

Re-import all 3691 BC2 projects against test DB + sandbox Dropbox folder.

#### 5f. Re-run audit on imported data

A second audit, this time over `projects` table (not BC2 source), to verify zero anomalies remain.

```
npx tsx scripts/audit-imported-projects.ts  # NEW: same classifier, different source
```

Out of scope to build for this spec — note as follow-up if signal warrants.

#### 5g. Ad-hoc inspection via Supabase MCP

With the Supabase MCP registered, post-migration verification can be done interactively:

- `mcp__supabase__query_documents` (or equivalent SQL execution tool) to spot-check counts per primary class, sample auto-created clients, dup suffix assignments
- `mcp__supabase__get_schema` to confirm constraint changes landed
- No need to swap `.env.local` for inspection — MCP talks directly to the test project via its registered project_ref

These are diagnostics, not part of the deliverable. Useful during the test-run iteration loop.

## Data Flow

```
Production clients ──► seed-clients-from-prod.ts ──► Test Supabase (clients pre-seeded)
                                                        │
BC2 API ──► migrate-bc2.ts (resolver-aware) ───────────►│
                          │                             ▼
                          │                       Test Supabase
                          │                       (projects, threads, files)
                          │
                          └─► tmp/bc2-import-orphans.csv (rows with no resolvable client)
                          │
                          └─► Dropbox /Projects-test/{client}/{folder}
```

## Output Artifacts

- `tmp/bc2-import-orphans.csv` — rows skipped due to `matchedBy=none`. Columns: `bc2_id, raw_title, archived, created_at, parser_attempt`. ~10–47 rows expected based on research probe.
- `tmp/bc2-import-summary.json` — counts per `matchedBy` outcome, dup suffix assignments, auto-created clients list.
- Stdout summary at end of migrator run — same shape as audit output for parity.

## Error Handling

**Resolver:**

- Pure function. Never throws. Empty/null input → `matchedBy: "none", confidence: "low", title: ""`.
- Unit-tested with the same fixture style as the classifier.

**Migrator:**

- Auto-create new client failure (e.g., normalized code collides with existing client of different name) → log warning, fall back to `auto-create-pending` orphan path.
- Suffix exhaustion (>26 dups in a group) → log warning, emit `a26`, `a27`, … and continue. Won't happen on current data.
- Unique-index conflict on `project_code` (the documented suffixed-num collision edge case) → throw with bc2_id + attempted code in error message; user must fix dataset and re-run.
- DB write failure → existing per-row try/catch reports failure and continues with next project (matches current `migrate-bc2.ts` pattern).

**Schema migration:**

- Test-environment first. After verification, production gets backed up (per standing rule) and then the same migration applied.

## Testing

### Unit tests

`tests/unit/bc2-client-resolver.test.ts` — 20+ fixtures covering each `matchedBy` outcome:

- Code match: `Cal-LPF-003: Foo` against client `{code: "CalLPF"}` → `clientId` set, `matchedBy: "code"`
- Name match: `Bird Marella - Website` against `{code: "BRD", name: "Bird Marella"}` → matched by name, num null
- Auto-create-pending: `Merrill Lynch-001: Foo` with no matching client → `matchedBy: "auto-create-pending"`, code/num parsed
- Total miss: `Alliance Business Solutions` → `matchedBy: "none"`
- Word-boundary safety: `GX Capabilities (Short)` does NOT match client `ABI` despite substring presence

`tests/unit/bc2-transformer.test.ts` — additions:

- Each new parser case (missing-colon, short-num, suffixed-num) gets a passing fixture
- Drift guard against bc2-title-classifier still passes after parser changes

`tests/unit/bc2-title-classifier.test.ts` — verify drift guard still green after parser regex changes (fixtures may need adjustment if any clean fixtures now reclassify).

### Integration test

Run on test Supabase + Dropbox sandbox:

1. `seed-clients-from-prod.ts` → test DB has 125 clients
2. `migrate-bc2.ts --mode=full --files` → completes
3. Manual spot-check via app:
   - Browse to a `prefix-noise` recovered project (e.g., `Cal-LPF-003`) — confirm correct client_id, project_code, breadcrumb
   - Browse to a `suffixed-num` project (e.g., `MMR-049A`) — confirm full code preserved
   - Browse to a `no-code` project assigned via name match (e.g., `BladeGuard site recovery`) — confirm client set, project_code shown as empty/dashes in UI, page renders
   - Check a duplicate group (`MON-458` + `MON-458a`) — both projects exist, distinct slugs, distinct Dropbox folders
4. Confirm `tmp/bc2-import-orphans.csv` count matches expected (~10–47)

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Schema migration breaks production reads | All 6 read sites already null-safe (verified in audit research); test-environment proves no regression before production migration |
| Resolver normalization is too aggressive (false positives) | Word-boundary / longest-prefix-of-leading-run only. No substring fallback. Validated by research probe (zero false positives in `prefix-noise`/`fallback-no-num` recovery). |
| Auto-created clients pollute `clients` table with bad data | Auto-create only on `matchedBy: "auto-create-pending"` with high-confidence parse (clean code+num). User can rename/merge in admin UI post-migration. List logged to `bc2-import-summary.json` for review. |
| Test Supabase + Dropbox sandbox setup is fragile | Test Supabase project `anrnlmmanhrddkvrnooe` already provisioned + MCP-registered. One-off bootstrap script (`seed-clients-from-prod.ts`) handles client seed. Reproducible. |
| Accidentally pointing migrator at production while testing | Use `.env.test.local` as a separate file, not just inline overrides. Make the swap explicit (symlink or copy) and visible in shell prompt or commit msg. Set `DROPBOX_PROJECTS_ROOT_FOLDER` in the test env file so a misconfigured run still lands files in the sandbox folder, not production. |
| Existing PR/branch work conflicts with these changes | Plan merges land on feature branch `feat/bc2-import-remediation`. Single combined PR for review. |
| Variants sharing `project_seq` collide with existing `(client_id, project_seq)` unique index | Schema migration drops `idx_projects_client_seq_unique` (Section 4). `project_code` uniqueness on its own is sufficient as identity guard. |

## Out-of-Scope Follow-Ups

1. **Audit-of-imported-projects script** — same classifier, different source (Postgres `projects` table). Run after migration to confirm zero anomalies.
2. **Admin merge UI** — for the ~5–10 typo-near-duplicate groups (`Steril-Aire-085: E-blast` vs `Eblast`).
3. **Client alias collapse** — `Bird` + `BRD` + `BirdMarella` all map to same client name "Bird Marella". Collapse to single canonical client + alias table.
4. **Production cutover plan** — backup, swap `DATABASE_URL`, re-run, validate, switch traffic. Separate spec.
5. **Manual triage workflow** — spreadsheet of orphan rows from `bc2-import-orphans.csv` for user to assign codes by hand, then re-run migrator.
