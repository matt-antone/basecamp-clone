# Basecamp 2 → Supabase Migration Design

**Date:** 2026-03-27
**Status:** Approved
**Scope:** Projects, discussions (threads + all comments), people (profiles), files

---

## Overview

A standalone CLI migration script that fetches data directly from the Basecamp 2 API and writes it into a Supabase branch database. Built for volume (10+ years of data), resilient to interruption, and safe to re-run. Existing import infrastructure (job tracking, mapping tables, idempotency) is reused and extended.

---

## Approach

**Standalone script** (`scripts/migrate-bc2.ts`) — not a web route. Reasons:
- No serverless timeout risk
- Connects directly to any Supabase branch via `DATABASE_URL`
- Easy to run with `--mode` flags for dry/limited/full
- Existing `import_jobs` / `import_logs` tables still provide full audit trail

---

## New Files

| File | Purpose |
|------|---------|
| `lib/imports/bc2-client.ts` | BC2 HTTP client — Basic auth, pagination, rate limiting, backoff |
| `lib/imports/bc2-fetcher.ts` | Fetches all required BC2 data (projects, people, messages, comments, attachments) |
| `lib/imports/bc2-transformer.ts` | Transforms BC2 shapes → local schema shapes (title parsing, client inference, people mapping) |
| `scripts/migrate-bc2.ts` | CLI entry point — parses flags, creates import job, orchestrates the run |

**Existing files left untouched:** `basecamp2-import.ts`, all API routes, all existing migrations.

---

## New Migration

**`supabase/migrations/0012_bc2_people_map.sql`**

```sql
-- Map BC2 person IDs to local user_profile IDs
create table if not exists import_map_people (
  id uuid primary key default gen_random_uuid(),
  basecamp_person_id text not null unique,
  local_user_profile_id text not null references user_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Flag legacy (dormant) profiles created from BC2 people
alter table user_profiles
  add column if not exists is_legacy boolean not null default false;

-- Index for fast email lookup during Google login reconciliation
create index if not exists idx_user_profiles_legacy_email
  on user_profiles(email) where is_legacy = true;
```

---

## Environment Variables

Add to `.env.local` (and document in `.env.example`):

```
BC2_ACCOUNT_ID=          # numeric account ID from basecamp.com/{id}
BC2_ACCESS_TOKEN=        # personal access token
BC2_USER_AGENT=          # required: "AppName (you@domain.com)"
```

---

## Data Mapping

### Fetch Order (dependencies dictate sequence)

```
1. People          → user_profiles (or legacy profiles) + import_map_people
2. Projects        → clients + projects + import_map_projects
3. Messages        → discussion_threads + import_map_threads
4. Comments        → discussion_comments + import_map_comments  (paginated per message)
5. Attachments     → project_files + import_map_files
```

### BC2 API Endpoints

| BC2 Resource | Endpoint |
|---|---|
| People | `GET /people.json` |
| Projects (active) | `GET /projects.json` |
| Projects (archived) | `GET /projects/archived.json` |
| Messages | `GET /projects/{id}/messages.json` |
| Comments | `GET /projects/{id}/messages/{id}/comments.json` |
| Vault files | `GET /projects/{id}/attachments.json` |

### Relationship Chain

```
People → user_profiles (matched by email) or legacy profile rows
Projects → clients (inferred) + projects
  └── Messages → discussion_threads
      ├── Comments → discussion_comments
      │   └── Inline attachments → project_files (thread_id + comment_id set)
      └── Inline attachments → project_files (thread_id set, no comment_id)
  └── Vault attachments → project_files (project_id only)
```

All foreign key relationships (author → user_profile, thread → project, comment → thread, file → project/thread/comment) are resolved via the import_map tables before inserting.

### Project Title Parsing

Format: `{ClientCode}-{Num}: {Title}` (with fallback for numberless variants)

```
"Poms-1414: Purple Mushroom Package"  → code=Poms,  num=1414, title="Purple Mushroom Package"
"JFLA-444: Invitation Graphic"        → code=JFLA,  num=444,  title="Invitation Graphic"
"GX-Website Review"                   → code=GX,    num=null, title="Website Review"
"POMS - Website Software Update"      → code=POMS,  num=null, title="Website Software Update"
```

Regex: `/^([A-Za-z]+)-(\d{3,4}):\s*(.+)$/` with fallback `/^([A-Za-z]+)\s*[-–]\s*(.+)$/`

Client lookup: match `clients.code` case-insensitively. If no match, create a new client with `code` as both `name` and `code` (can be renamed in the UI later).

### Legacy Profile Reconciliation

**During import:**
- For each BC2 person, look up `user_profiles` by email
- If matched → use existing profile, record in `import_map_people`
- If not matched → create `user_profile` row with `id = 'bc2_{person_id}'`, `is_legacy = true`

**On first Google login (existing auth flow — minor addition):**
- After Google UID is confirmed, check for a `user_profiles` row with matching email and `is_legacy = true`
- If found: update `id` → Google UID, set `is_legacy = false`, update `import_map_people`

---

## Volume & Resilience

### Scale
10+ years of data: hundreds of projects, thousands of messages, tens of thousands of comments, potentially thousands of files. Full migration expected to take hours.

### Streaming, Not Bulk Loading
Process project-by-project. Never load all data into memory. Use async generators through BC2 pagination. Each project's messages and comments are fetched and inserted before moving to the next project.

### BC2 API Rate Limiting
- Default 200ms delay between requests (configurable via `BC2_REQUEST_DELAY_MS`)
- Detect `429 Too Many Requests` → exponential backoff (1s, 2s, 4s, max 30s)
- Rate limit events logged to stdout and `import_logs`

### Resumability
The existing `import_map_*` tables provide full idempotency. Before inserting any record, check the map. If already present, skip. A failed full run can be restarted from scratch without creating duplicates.

### Concurrent File Uploads
In full mode: file downloads from BC2 + uploads to Dropbox run with concurrency cap of 3. Each file is individually retried on failure (up to 3 attempts) without failing the whole job.

### Progress Output
Concise — one line per project, summary at end:

```
[BC2 Migration] mode=full  branch=dev-migration
Fetching 247 projects...
[  1/247] ALG-005   3 threads  18 comments   2 files ✓
[  2/247] BRGS-075  1 thread    4 comments   0 files ✓
...
Done in 4h 12m — 247 projects, 3,841 threads, 29,442 comments, 1,203 files
Errors: 3 (see import_logs job_id=abc123)
```

Errors noted inline but do not stop the run. Full detail in `import_logs`.

### Graceful Interruption
On `SIGINT` (Ctrl+C): mark job as `interrupted` (not `failed`), exit cleanly. Next run resumes via import maps.

---

## Run Modes

### `--mode=dry`
- Fetches from BC2 but writes nothing to DB
- Same progress output with `(dry)` marker
- Final report: counts of what *would* be created
- Use for: validating credentials, previewing project/client counts

### `--mode=limited`
- Processes first N projects (default 5; set with `--limit=N`)
- Full DB writes — real data, real import maps
- File uploads skipped unless `--files` flag also passed
- Use for: validating a sample before committing to full run

### `--mode=full`
- Processes all projects, all comments, all files
- Files downloaded from BC2 and uploaded to Dropbox via existing upload protocol
- Safe to re-run — import maps prevent duplicates

### CLI Examples

```bash
# Preview what would be migrated
npx tsx scripts/migrate-bc2.ts --mode=dry

# Migrate 10 projects (no files)
npx tsx scripts/migrate-bc2.ts --mode=limited --limit=10

# Migrate 10 projects including files
npx tsx scripts/migrate-bc2.ts --mode=limited --limit=10 --files

# Full migration
npx tsx scripts/migrate-bc2.ts --mode=full

# Resume full run from a specific project (by BC2 project name prefix)
npx tsx scripts/migrate-bc2.ts --mode=full --from-project=Poms-1414
```

---

## Supabase Branch Workflow

```bash
# 1. Create a branch in Supabase dashboard or CLI
supabase branches create dev-migration

# 2. Get the branch connection string and set in .env.local
DATABASE_URL=postgresql://postgres:...@db.{branch-ref}.supabase.co:5432/postgres

# 3. Apply new migration to the branch
supabase db push --linked

# 4. Run the migration script
npx tsx scripts/migrate-bc2.ts --mode=dry
```

---

## What Is Not Changing

- Existing `basecamp2-import.ts` and all API routes — untouched
- All existing migrations — untouched
- Auth flow — only a minor addition to the existing first-login path for legacy profile matching
- Dropbox upload protocol — reused as-is for file migration in full mode
