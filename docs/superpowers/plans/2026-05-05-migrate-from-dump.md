# Migrate from BC2 Dump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `scripts/migrate-from-dump.ts` that imports the local BC2 dump (`/Volumes/Spare/basecamp-dump/`) into Postgres + Dropbox, falling back to the live BC2 API when the dump is missing data, and streaming attachment binaries through from BC2.

**Architecture:** New entry point uses a `DumpReader` abstraction that resolves each request from disk first and falls back to the existing `Bc2Client` when needed. Migration phases (people / projects / threads / files) live as standalone modules under `lib/imports/migration/`. Old `scripts/migrate-bc2.ts` is left untouched. A small SQL migration adds `import_logs.data_source` to track dump-vs-api per row.

**Tech Stack:** TypeScript, Node 22, pnpm, vitest, pg, dotenv, Supabase Postgres, existing `Bc2Client`, existing `downloadBc2Attachment`, existing repository helpers in `lib/repositories.ts`.

**Spec:** `docs/superpowers/specs/2026-05-05-migrate-from-dump-design.md`

---

## File Structure

**Created:**
- `supabase/migrations/0029_import_logs_data_source.sql`
- `lib/imports/dump-reader.ts`
- `lib/imports/migration/types.ts`
- `lib/imports/migration/jobs.ts`
- `lib/imports/migration/people.ts`
- `lib/imports/migration/projects.ts`
- `lib/imports/migration/threads.ts`
- `lib/imports/migration/files.ts`
- `scripts/migrate-from-dump.ts`
- `tests/unit/dump-reader.test.ts`
- `tests/unit/migration-jobs.test.ts`
- `tests/unit/migration-people.test.ts`
- `tests/unit/migration-projects.test.ts`
- `tests/unit/migration-threads.test.ts`
- `tests/unit/migration-files.test.ts`
- `tests/integration/migrate-from-dump.test.ts`
- `tests/support/dump-fixture.ts` (helper to build a temp dump dir)

**Modified:**
- `package.json` (add `migrate:from-dump` script)

**Untouched:**
- `scripts/migrate-bc2.ts`
- `lib/imports/bc2-client.ts`, `bc2-fetcher.ts`, `bc2-transformer.ts`, `bc2-attachment-download.ts`, `bc2-attachment-linkage.ts`, `bc2-migrate-single-file.ts`, `bc2-client-resolver.ts`

---

## Task 0: Worktree + branch

**Files:** none

- [ ] **Step 0.1: Create branch**

```bash
git switch -c feat/migrate-from-dump
```

- [ ] **Step 0.2: Confirm dump exists**

```bash
ls /Volumes/Spare/basecamp-dump/people.json /Volumes/Spare/basecamp-dump/projects/active.json
```

Expected: both files listed. If either is missing, run `pnpm dump:bc2 --limit=2` to seed minimal content.

---

## Task 1: SQL migration — `import_logs.data_source`

**Files:**
- Create: `supabase/migrations/0029_import_logs_data_source.sql`

- [ ] **Step 1.1: Write migration**

```sql
-- supabase/migrations/0029_import_logs_data_source.sql
-- Adds data_source so the new dump-based migrator can record whether each
-- record came from the local BC2 dump or the live BC2 API. Default 'api'
-- preserves the meaning of all existing rows from scripts/migrate-bc2.ts.

alter table import_logs
  add column if not exists data_source text not null default 'api';

create index if not exists import_logs_job_data_source_idx
  on import_logs (job_id, data_source);
```

- [ ] **Step 1.2: Apply migration locally**

```bash
psql "$DATABASE_URL" -f supabase/migrations/0029_import_logs_data_source.sql
```

Expected: `ALTER TABLE` and `CREATE INDEX` notices, no errors.

- [ ] **Step 1.3: Verify column exists**

```bash
psql "$DATABASE_URL" -c "\\d import_logs" | grep data_source
```

Expected: a row showing `data_source | text | not null default 'api'::text`.

- [ ] **Step 1.4: Commit**

```bash
git add supabase/migrations/0029_import_logs_data_source.sql
git commit -m "feat(db): add import_logs.data_source for dump vs api audit"
```

---

## Task 2: Migration job + record helpers (`lib/imports/migration/jobs.ts`)

**Files:**
- Create: `lib/imports/migration/jobs.ts`
- Test: `tests/unit/migration-jobs.test.ts`

The new lib intentionally duplicates (does not import) the old script's
helpers. The new helpers add a `data_source` column write.

- [ ] **Step 2.1: Write the failing test**

```ts
// tests/unit/migration-jobs.test.ts
import { describe, it, expect } from "vitest";
import {
  createImportJob,
  logRecord,
  incrementCounters,
  finishJob,
  type Query,
} from "@/lib/imports/migration/jobs";

function fakeQuery() {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const q: Query = (async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith("insert into import_jobs")) {
      return { rows: [{ id: "job-1" }] };
    }
    return { rows: [] };
  }) as Query;
  return { calls, q };
}

describe("migration/jobs", () => {
  it("createImportJob writes options and returns id", async () => {
    const { calls, q } = fakeQuery();
    const id = await createImportJob(q, { source: "dump" });
    expect(id).toBe("job-1");
    expect(calls[0].sql).toContain("insert into import_jobs");
    expect(JSON.parse(String(calls[0].values[0]))).toEqual({ source: "dump" });
  });

  it("logRecord writes data_source column", async () => {
    const { calls, q } = fakeQuery();
    await logRecord(q, {
      jobId: "job-1",
      recordType: "thread",
      sourceId: "12345",
      status: "success",
      dataSource: "dump",
    });
    expect(calls[0].sql).toContain("insert into import_logs");
    expect(calls[0].sql).toContain("data_source");
    expect(calls[0].values).toEqual([
      "job-1",
      "thread",
      "12345",
      "success",
      null,
      "dump",
    ]);
  });

  it("incrementCounters and finishJob hit import_jobs", async () => {
    const { calls, q } = fakeQuery();
    await incrementCounters(q, "job-1", 3, 1);
    await finishJob(q, "job-1", "completed");
    expect(calls[0].sql).toContain("update import_jobs");
    expect(calls[1].sql).toContain("status=$2");
  });
});
```

- [ ] **Step 2.2: Run the failing test**

```bash
pnpm vitest run tests/unit/migration-jobs.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement `lib/imports/migration/jobs.ts`**

```ts
// lib/imports/migration/jobs.ts
import type { QueryResultRow } from "pg";

export type Query = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[] }>;

export type DataSource = "dump" | "api";

export async function createImportJob(q: Query, options: object): Promise<string> {
  const r = await q<{ id: string }>(
    "insert into import_jobs (status, options) values ('running', $1) returning id",
    [JSON.stringify(options)],
  );
  return r.rows[0].id;
}

export async function logRecord(
  q: Query,
  args: {
    jobId: string;
    recordType: string;
    sourceId: string;
    status: "success" | "failed";
    message?: string | null;
    dataSource: DataSource;
  },
): Promise<void> {
  await q(
    "insert into import_logs (job_id, record_type, source_record_id, status, message, data_source) values ($1,$2,$3,$4,$5,$6)",
    [
      args.jobId,
      args.recordType,
      args.sourceId,
      args.status,
      args.message ?? null,
      args.dataSource,
    ],
  );
}

export async function incrementCounters(
  q: Query,
  jobId: string,
  success: number,
  failed: number,
): Promise<void> {
  await q(
    `update import_jobs set
       success_count = success_count + $2,
       failed_count  = failed_count  + $3,
       total_records = total_records + $2 + $3
     where id = $1`,
    [jobId, success, failed],
  );
}

export async function finishJob(
  q: Query,
  jobId: string,
  status: "completed" | "failed" | "interrupted",
): Promise<void> {
  await q(
    "update import_jobs set status=$2, finished_at=now() where id=$1",
    [jobId, status],
  );
}
```

- [ ] **Step 2.4: Run tests to verify pass**

```bash
pnpm vitest run tests/unit/migration-jobs.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 2.5: Commit**

```bash
git add lib/imports/migration/jobs.ts tests/unit/migration-jobs.test.ts
git commit -m "feat(migration): import job/log helpers with data_source"
```

---

## Task 3: Shared types (`lib/imports/migration/types.ts`)

**Files:**
- Create: `lib/imports/migration/types.ts`

- [ ] **Step 3.1: Write file**

```ts
// lib/imports/migration/types.ts

export type Phase = "people" | "projects" | "threads" | "files" | "all";
export type ProjectFilter = "active" | "archived" | "all";

export interface CliFlags {
  phase: Phase;
  projects: ProjectFilter;
  limit: number | null;
  projectId: number | null;
  dumpDir: string;
  dryRun: boolean;
  noFiles: boolean;
}

export interface MigratedProject {
  bc2Id: number;
  localId: string;
  name: string;
}
```

- [ ] **Step 3.2: Commit**

```bash
git add lib/imports/migration/types.ts
git commit -m "feat(migration): shared types"
```

---

## Task 4: DumpReader (`lib/imports/dump-reader.ts`)

**Files:**
- Create: `lib/imports/dump-reader.ts`
- Test: `tests/unit/dump-reader.test.ts`

DumpReader is the only component that knows the dump's directory layout.

- [ ] **Step 4.1: Write the failing test**

```ts
// tests/unit/dump-reader.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { Bc2Client } from "@/lib/imports/bc2-client";
import { createDumpReader } from "@/lib/imports/dump-reader";

async function makeDump(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "dump-"));
}

function stubClient(getImpl: (p: string) => Promise<unknown>): Bc2Client {
  return {
    get: vi.fn(async (p: string) => ({ body: await getImpl(p), nextUrl: null })),
  } as unknown as Bc2Client;
}

describe("DumpReader", () => {
  let dumpDir: string;
  beforeEach(async () => {
    dumpDir = await makeDump();
  });

  it("returns dump source when JSON file exists", async () => {
    await fs.writeFile(path.join(dumpDir, "people.json"), JSON.stringify([{ id: 1 }]));
    const reader = createDumpReader({
      dumpDir,
      client: stubClient(async () => {
        throw new Error("api should not be called");
      }),
      errors: new Set(),
    });
    const out = await reader.people();
    expect(out.source).toBe("dump");
    expect(out.body).toEqual([{ id: 1 }]);
  });

  it("falls back to API when JSON file missing", async () => {
    const client = stubClient(async () => [{ id: 99 }]);
    const reader = createDumpReader({ dumpDir, client, errors: new Set() });
    const out = await reader.people();
    expect(out.source).toBe("api");
    expect(out.body).toEqual([{ id: 99 }]);
  });

  it("falls back to API when path is in errors set", async () => {
    const projectsDir = path.join(dumpDir, "projects");
    await fs.mkdir(projectsDir, { recursive: true });
    await fs.writeFile(path.join(projectsDir, "active.json"), JSON.stringify([{ id: 1 }]));
    const errors = new Set(["projects/active.json"]);
    const client = stubClient(async () => [{ id: 2 }]);
    const reader = createDumpReader({ dumpDir, client, errors });
    const out = await reader.activeProjects();
    expect(out.source).toBe("api");
    expect(out.body).toEqual([{ id: 2 }]);
  });

  it("topicDetail reads dump for known type, falls back to API when file missing", async () => {
    const dir = path.join(dumpDir, "by-project", "10", "messages");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "55.json"), JSON.stringify({ id: 55 }));
    const reader = createDumpReader({
      dumpDir,
      client: stubClient(async () => null),
      errors: new Set(),
    });
    const hit = await reader.topicDetail(10, "Message", 55);
    expect(hit.source).toBe("dump");
    expect(hit.body).toEqual({ id: 55 });
    const miss = await reader.topicDetail(10, "Message", 999);
    expect(miss.source).toBe("api");
    expect(miss.body).toBeNull();
  });
});
```

- [ ] **Step 4.2: Run the failing test**

```bash
pnpm vitest run tests/unit/dump-reader.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement `lib/imports/dump-reader.ts`**

```ts
// lib/imports/dump-reader.ts
import { promises as fs } from "fs";
import * as path from "path";
import { Bc2Client } from "./bc2-client";

export interface DumpSource<T = unknown> {
  source: "dump" | "api";
  body: T;
}

export const TOPICABLE_TO_SEGMENT: Record<string, string> = {
  Message: "messages",
  Todolist: "todolists",
  CalendarEvent: "calendar_events",
  Calendar: "calendar_events",
  Upload: "uploads",
  Document: "documents",
};

export interface DumpReader {
  people(): Promise<DumpSource>;
  activeProjects(): Promise<DumpSource>;
  archivedProjects(): Promise<DumpSource>;
  topics(projectId: number): Promise<DumpSource>;
  topicDetail(projectId: number, topicableType: string, topicableId: number): Promise<DumpSource>;
  attachments(projectId: number): Promise<DumpSource>;
}

export interface DumpReaderOptions {
  dumpDir: string;
  client: Bc2Client;
  errors: Set<string>;
}

async function readIfExists(absPath: string): Promise<unknown | null> {
  try {
    const buf = await fs.readFile(absPath, "utf8");
    if (buf.trim().length === 0) return null;
    return JSON.parse(buf);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function fetchPaginated(client: Bc2Client, firstPath: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let next: string | null = firstPath;
  while (next) {
    const res = await client.get<unknown[]>(next);
    if (Array.isArray(res.body)) out.push(...res.body);
    next = res.nextUrl;
  }
  return out;
}

export function createDumpReader(opts: DumpReaderOptions): DumpReader {
  const { dumpDir, client, errors } = opts;

  async function tryDump(relPath: string, fallback: () => Promise<unknown>): Promise<DumpSource> {
    if (errors.has(relPath)) {
      return { source: "api", body: await fallback() };
    }
    const body = await readIfExists(path.join(dumpDir, relPath));
    if (body !== null) return { source: "dump", body };
    return { source: "api", body: await fallback() };
  }

  return {
    people() {
      return tryDump("people.json", () => fetchPaginated(client, "/people.json"));
    },
    activeProjects() {
      return tryDump("projects/active.json", () =>
        fetchPaginated(client, "/projects.json"),
      );
    },
    archivedProjects() {
      return tryDump("projects/archived.json", () =>
        fetchPaginated(client, "/projects/archived.json"),
      );
    },
    topics(projectId) {
      const rel = `by-project/${projectId}/topics.json`;
      return tryDump(rel, () =>
        fetchPaginated(client, `/projects/${projectId}/topics.json`),
      );
    },
    topicDetail(projectId, topicableType, topicableId) {
      const segment = TOPICABLE_TO_SEGMENT[topicableType];
      if (!segment) {
        return Promise.resolve({ source: "api" as const, body: null });
      }
      const rel = `by-project/${projectId}/${segment}/${topicableId}.json`;
      return tryDump(rel, async () => {
        const res = await client.get(`/projects/${projectId}/${segment}/${topicableId}.json`);
        return res.body;
      });
    },
    attachments(projectId) {
      const rel = `by-project/${projectId}/attachments.json`;
      return tryDump(rel, () =>
        fetchPaginated(client, `/projects/${projectId}/attachments.json`),
      );
    },
  };
}
```

- [ ] **Step 4.4: Run tests**

```bash
pnpm vitest run tests/unit/dump-reader.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 4.5: Commit**

```bash
git add lib/imports/dump-reader.ts tests/unit/dump-reader.test.ts
git commit -m "feat(imports): DumpReader with API fallback"
```

---

## Task 5: People migration (`lib/imports/migration/people.ts`)

**Files:**
- Create: `lib/imports/migration/people.ts`
- Test: `tests/unit/migration-people.test.ts`

This phase mirrors `migratePeople()` in the old script but takes a `DumpReader`.

- [ ] **Step 5.1: Read the existing `migratePeople`**

In `scripts/migrate-bc2.ts`, locate `async function migratePeople(`. It
iterates `Bc2Person[]`, calls `resolvePerson` (and possibly
`reconcileLegacyProfile`) from the transformer, writes to
`import_map_people` and `import_logs`. The new version replaces the
iterator source but keeps the same DB logic.

- [ ] **Step 5.2: Write the failing test**

```ts
// tests/unit/migration-people.test.ts
import { describe, it, expect, vi } from "vitest";
import { migratePeople } from "@/lib/imports/migration/people";
import type { Query } from "@/lib/imports/migration/jobs";
import type { DumpReader } from "@/lib/imports/dump-reader";

vi.mock("@/lib/imports/bc2-transformer", () => ({
  resolvePerson: vi.fn(async (p: { id: number; email_address: string; name: string }) => ({
    profileId: `profile-${p.id}`,
    isNew: true,
  })),
  reconcileLegacyProfile: vi.fn(async () => undefined),
}));

function stubReader(people: unknown[]): DumpReader {
  return {
    people: vi.fn(async () => ({ source: "dump", body: people })),
    activeProjects: vi.fn(),
    archivedProjects: vi.fn(),
    topics: vi.fn(),
    topicDetail: vi.fn(),
    attachments: vi.fn(),
  } as unknown as DumpReader;
}

function fakeQuery() {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const q: Query = (async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    return { rows: [] };
  }) as Query;
  return { calls, q };
}

describe("migratePeople", () => {
  it("upserts each person and logs data_source=dump", async () => {
    const { calls, q } = fakeQuery();
    const reader = stubReader([
      { id: 1, email_address: "a@b.com", name: "A" },
      { id: 2, email_address: "c@d.com", name: "C" },
    ]);
    const summary = await migratePeople({ reader, q, jobId: "job-1" });
    expect(summary).toEqual({ success: 2, failed: 0 });
    const inserts = calls.filter(c => c.sql.startsWith("insert into import_map_people"));
    expect(inserts).toHaveLength(2);
    const logs = calls.filter(c => c.sql.startsWith("insert into import_logs"));
    expect(logs.every(l => l.values[5] === "dump")).toBe(true);
  });
});
```

- [ ] **Step 5.3: Run failing test**

```bash
pnpm vitest run tests/unit/migration-people.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5.4: Implement `lib/imports/migration/people.ts`**

```ts
// lib/imports/migration/people.ts
import { resolvePerson, reconcileLegacyProfile } from "../bc2-transformer";
import { logRecord, type Query, type DataSource } from "./jobs";
import type { DumpReader } from "../dump-reader";

interface Bc2PersonShape {
  id: number;
  email_address: string;
  name: string;
}

export async function migratePeople(args: {
  reader: DumpReader;
  q: Query;
  jobId: string;
}): Promise<{ success: number; failed: number }> {
  const { reader, q, jobId } = args;
  let success = 0;
  let failed = 0;

  const peopleResult = await reader.people();
  const dataSource: DataSource = peopleResult.source;
  const people = (peopleResult.body ?? []) as Bc2PersonShape[];

  for (const person of people) {
    try {
      const resolved = await resolvePerson(person as never, jobId);
      await reconcileLegacyProfile(person as never, resolved.profileId);
      await q(
        `insert into import_map_people (basecamp_person_id, local_user_profile_id)
         values ($1, $2)
         on conflict (basecamp_person_id) do update set local_user_profile_id = excluded.local_user_profile_id`,
        [String(person.id), resolved.profileId],
      );
      await logRecord(q, {
        jobId,
        recordType: "person",
        sourceId: String(person.id),
        status: "success",
        dataSource,
      });
      success++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logRecord(q, {
        jobId,
        recordType: "person",
        sourceId: String(person.id),
        status: "failed",
        message,
        dataSource,
      });
      failed++;
    }
  }
  return { success, failed };
}
```

Notes for engineer: `resolvePerson` and `reconcileLegacyProfile` are
defined in `lib/imports/bc2-transformer.ts`. The dump JSON is the same
shape `Bc2Person` from `bc2-fetcher.ts`, so the `as never` cast is
acceptable.

- [ ] **Step 5.5: Run tests**

```bash
pnpm vitest run tests/unit/migration-people.test.ts
```

Expected: PASS.

- [ ] **Step 5.6: Commit**

```bash
git add lib/imports/migration/people.ts tests/unit/migration-people.test.ts
git commit -m "feat(migration): people phase reading dump with API fallback"
```

---

## Task 6: Projects migration (`lib/imports/migration/projects.ts`)

**Files:**
- Create: `lib/imports/migration/projects.ts`
- Test: `tests/unit/migration-projects.test.ts`

The old `migrateProjects` does dup-suffix slug planning, calls
`createProject`, writes `import_map_projects`. Reproduce that,
parameterized on the reader.

- [ ] **Step 6.1: Locate the old function**

`scripts/migrate-bc2.ts` → `async function migrateProjects(` and the
helpers `function planDupSuffixes(...)` and `function slugify(...)`.

- [ ] **Step 6.2: Write the failing test**

```ts
// tests/unit/migration-projects.test.ts
import { describe, it, expect, vi } from "vitest";
import { migrateProjects } from "@/lib/imports/migration/projects";
import type { Query } from "@/lib/imports/migration/jobs";
import type { DumpReader } from "@/lib/imports/dump-reader";

vi.mock("@/lib/repositories", () => ({
  createProject: vi.fn(async () => ({ id: "proj-uuid" })),
}));
vi.mock("@/lib/imports/bc2-client-resolver", () => ({
  resolveTitle: vi.fn(async () => ({
    code: "ALG-001",
    title: "Test Project",
    clientSlug: "alg",
  })),
}));

function stubReader(active: unknown[], archived: unknown[]): DumpReader {
  return {
    people: vi.fn(),
    activeProjects: vi.fn(async () => ({ source: "dump", body: active })),
    archivedProjects: vi.fn(async () => ({ source: "dump", body: archived })),
    topics: vi.fn(),
    topicDetail: vi.fn(),
    attachments: vi.fn(),
  } as unknown as DumpReader;
}

function fakeQuery() {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const q: Query = (async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    return { rows: [] };
  }) as Query;
  return { calls, q };
}

describe("migrateProjects", () => {
  it("creates active+archived, writes import_map_projects, logs data_source=dump", async () => {
    const { calls, q } = fakeQuery();
    const reader = stubReader(
      [{ id: 100, name: "Active 1", archived: false }],
      [{ id: 200, name: "Archived 1", archived: true }],
    );
    const out = await migrateProjects({
      reader,
      q,
      jobId: "job-1",
      filter: "all",
      limit: null,
      onlyProjectId: null,
      knownClients: [],
    });
    expect(out.migrated.map(p => p.bc2Id).sort()).toEqual([100, 200]);
    const logs = calls.filter(c => c.sql.startsWith("insert into import_logs"));
    expect(logs.every(l => l.values[5] === "dump")).toBe(true);
  });
});
```

- [ ] **Step 6.3: Run failing test**

```bash
pnpm vitest run tests/unit/migration-projects.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 6.4: Implement `lib/imports/migration/projects.ts`**

```ts
// lib/imports/migration/projects.ts
import { createProject } from "@/lib/repositories";
import { resolveTitle, type KnownClient } from "../bc2-client-resolver";
import { logRecord, type Query, type DataSource } from "./jobs";
import type { DumpReader } from "../dump-reader";
import type { MigratedProject, ProjectFilter } from "./types";

interface Bc2ProjectShape {
  id: number;
  name: string;
  archived?: boolean;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface PrePassEntry {
  bc2Id: number;
  rawName: string;
  resolved: Awaited<ReturnType<typeof resolveTitle>>;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function planDupSuffixes(entries: PrePassEntry[]): Map<string, string> {
  const counts = new Map<string, number>();
  const out = new Map<string, string>();
  for (const e of entries) {
    const key = `${e.resolved.code}|${slugify(e.resolved.title)}`;
    const idx = (counts.get(key) ?? 0) + 1;
    counts.set(key, idx);
    out.set(String(e.bc2Id), idx === 1 ? "" : `-${idx}`);
  }
  return out;
}

export async function migrateProjects(args: {
  reader: DumpReader;
  q: Query;
  jobId: string;
  filter: ProjectFilter;
  limit: number | null;
  onlyProjectId: number | null;
  knownClients: KnownClient[];
}): Promise<{ migrated: MigratedProject[] }> {
  const { reader, q, jobId, filter, limit, onlyProjectId, knownClients } = args;

  const sources: Array<{
    src: "active" | "archived";
    data: Bc2ProjectShape[];
    dataSource: DataSource;
  }> = [];
  if (filter === "active" || filter === "all") {
    const r = await reader.activeProjects();
    sources.push({ src: "active", data: (r.body ?? []) as Bc2ProjectShape[], dataSource: r.source });
  }
  if (filter === "archived" || filter === "all") {
    const r = await reader.archivedProjects();
    sources.push({ src: "archived", data: (r.body ?? []) as Bc2ProjectShape[], dataSource: r.source });
  }

  let candidates = sources.flatMap(s =>
    s.data.map(p => ({ project: p, dataSource: s.dataSource })),
  );

  if (onlyProjectId !== null) {
    candidates = candidates.filter(c => c.project.id === onlyProjectId);
  }
  if (limit !== null && limit > 0) {
    candidates = candidates.slice(0, limit);
  }

  // Resolve titles up front so the dup-suffix planner can run.
  const prepass: PrePassEntry[] = [];
  for (const c of candidates) {
    const resolved = await resolveTitle(c.project.name, knownClients, c.project.id);
    prepass.push({ bc2Id: c.project.id, rawName: c.project.name, resolved });
  }
  const dupSuffix = planDupSuffixes(prepass);

  const migrated: MigratedProject[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const { project, dataSource } = candidates[i];
    const resolved = prepass[i].resolved;
    try {
      const existing = await q<{ local_project_id: string }>(
        "select local_project_id from import_map_projects where basecamp_project_id = $1",
        [String(project.id)],
      );
      let localId: string;
      if (existing.rows[0]) {
        localId = existing.rows[0].local_project_id;
      } else {
        const dup = dupSuffix.get(String(project.id)) ?? "";
        const created = await createProject({
          code: resolved.code + dup,
          title: resolved.title,
          clientSlug: resolved.clientSlug,
          isArchived: !!project.archived,
          description: project.description ?? null,
          createdAt: project.created_at,
          updatedAt: project.updated_at,
          source: "bc2_import",
        } as never);
        localId = (created as { id: string }).id;
        await q(
          "insert into import_map_projects (basecamp_project_id, local_project_id) values ($1, $2)",
          [String(project.id), localId],
        );
      }
      migrated.push({ bc2Id: project.id, localId, name: project.name });
      await logRecord(q, {
        jobId,
        recordType: "project",
        sourceId: String(project.id),
        status: "success",
        dataSource,
      });
    } catch (err) {
      await logRecord(q, {
        jobId,
        recordType: "project",
        sourceId: String(project.id),
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
        dataSource,
      });
    }
  }
  return { migrated };
}
```

- [ ] **Step 6.5: Reconcile `createProject` signature**

Open `lib/repositories.ts` and find the `createProject(args: {...})` definition.
Compare its argument shape to the call inside `migrateProjects`. Update
the call site to match exactly. If the real signature requires extra
fields (e.g. `storageProjectDir`), follow the original
`migrate-bc2.ts:migrateProjects` invocation — that call is the
authoritative reference.

- [ ] **Step 6.6: Run tests**

```bash
pnpm vitest run tests/unit/migration-projects.test.ts
```

Expected: PASS.

- [ ] **Step 6.7: Commit**

```bash
git add lib/imports/migration/projects.ts tests/unit/migration-projects.test.ts
git commit -m "feat(migration): projects phase reading dump with API fallback"
```

---

## Task 7: Threads + comments migration (`lib/imports/migration/threads.ts`)

**Files:**
- Create: `lib/imports/migration/threads.ts`
- Test: `tests/unit/migration-threads.test.ts`

Iterates `reader.topics(projectId)` then `reader.topicDetail(...)` for each
topic, calls `createThread` + `createComment`, writes
`import_map_threads` and `import_map_comments`.

- [ ] **Step 7.1: Locate the old function**

`scripts/migrate-bc2.ts` → `async function migrateThreadsAndComments(...)`.

- [ ] **Step 7.2: Write the failing test**

```ts
// tests/unit/migration-threads.test.ts
import { describe, it, expect, vi } from "vitest";
import { migrateThreadsAndComments } from "@/lib/imports/migration/threads";
import type { Query } from "@/lib/imports/migration/jobs";
import type { DumpReader } from "@/lib/imports/dump-reader";

vi.mock("@/lib/repositories", () => ({
  createThread: vi.fn(async () => ({ id: "thread-uuid" })),
  createComment: vi.fn(async () => ({ id: "comment-uuid" })),
}));

function stubReader(): DumpReader {
  return {
    people: vi.fn(),
    activeProjects: vi.fn(),
    archivedProjects: vi.fn(),
    topics: vi.fn(async () => ({
      source: "dump",
      body: [
        { id: 1, title: "T1", topicable: { id: 11, type: "Message" } },
        { id: 2, title: "T2", topicable: { id: 22, type: "CalendarEvent" } },
      ],
    })),
    topicDetail: vi.fn(async (_p, type, id) => ({
      source: "dump",
      body: { id, type, content: "<p>hi</p>", comments: [{ id: 999, content: "yo" }] },
    })),
    attachments: vi.fn(),
  } as unknown as DumpReader;
}

function fakeQuery() {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const q: Query = (async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    return { rows: [] };
  }) as Query;
  return { calls, q };
}

describe("migrateThreadsAndComments", () => {
  it("imports Message topics, skips CalendarEvent with logged skip", async () => {
    const { calls, q } = fakeQuery();
    const reader = stubReader();
    const out = await migrateThreadsAndComments({
      reader,
      q,
      jobId: "job-1",
      project: { bc2Id: 100, localId: "proj-uuid", name: "X" },
      personMap: new Map([[1, "user-1"]]),
    });
    expect(out.threads.success).toBe(1);
    expect(out.threads.skipped).toBe(1);
    const logs = calls.filter(c => c.sql.startsWith("insert into import_logs"));
    expect(logs.some(l =>
      l.values[1] === "thread"
      && l.values[3] === "failed"
      && String(l.values[4]).startsWith("skipped_topicable_type="))).toBe(true);
  });
});
```

- [ ] **Step 7.3: Run failing test**

```bash
pnpm vitest run tests/unit/migration-threads.test.ts
```

Expected: FAIL.

- [ ] **Step 7.4: Implement `lib/imports/migration/threads.ts`**

```ts
// lib/imports/migration/threads.ts
import { createThread, createComment } from "@/lib/repositories";
import { logRecord, type Query, type DataSource } from "./jobs";
import type { DumpReader } from "../dump-reader";
import type { MigratedProject } from "./types";

const SUPPORTED_TOPICS = new Set([
  "Message",
  "Todolist",
  "Upload",
  "Document",
]);

interface Bc2TopicSummary {
  id: number;
  title?: string;
  topicable: { id: number; type: string };
}

interface Bc2CommentShape {
  id: number;
  content?: string;
  creator?: { id: number };
  created_at?: string;
}

interface Bc2ThreadDetail {
  id: number;
  subject?: string;
  title?: string;
  content?: string;
  body?: string;
  creator?: { id: number };
  created_at?: string;
  updated_at?: string;
  comments?: Bc2CommentShape[];
}

export async function migrateThreadsAndComments(args: {
  reader: DumpReader;
  q: Query;
  jobId: string;
  project: MigratedProject;
  personMap: Map<number, string>;
}): Promise<{ threads: { success: number; failed: number; skipped: number } }> {
  const { reader, q, jobId, project, personMap } = args;
  let success = 0;
  let failed = 0;
  let skipped = 0;

  const topicsRes = await reader.topics(project.bc2Id);
  const topics = (topicsRes.body ?? []) as Bc2TopicSummary[];
  const dataSource: DataSource = topicsRes.source;

  for (const topic of topics) {
    const t = topic.topicable;
    if (!t || !SUPPORTED_TOPICS.has(t.type)) {
      await logRecord(q, {
        jobId,
        recordType: "thread",
        sourceId: String(t?.id ?? topic.id),
        status: "failed", // import_logs.status enum has only success/failed
        message: `skipped_topicable_type=${t?.type ?? "unknown"}`,
        dataSource,
      });
      skipped++;
      continue;
    }
    try {
      const detailRes = await reader.topicDetail(project.bc2Id, t.type, t.id);
      const detail = (detailRes.body ?? {}) as Bc2ThreadDetail;
      const existing = await q<{ local_thread_id: string }>(
        "select local_thread_id from import_map_threads where basecamp_thread_id = $1",
        [String(t.id)],
      );
      let localThreadId: string;
      if (existing.rows[0]) {
        localThreadId = existing.rows[0].local_thread_id;
      } else {
        const created = await createThread({
          projectId: project.localId,
          title: detail.subject ?? detail.title ?? topic.title ?? "(untitled)",
          contentHtml: detail.content ?? detail.body ?? "",
          authorUserProfileId: detail.creator ? personMap.get(detail.creator.id) ?? null : null,
          createdAt: detail.created_at,
          updatedAt: detail.updated_at,
          topicableType: t.type,
          source: "bc2_import",
        } as never);
        localThreadId = (created as { id: string }).id;
        await q(
          "insert into import_map_threads (basecamp_thread_id, local_thread_id) values ($1, $2)",
          [String(t.id), localThreadId],
        );
      }
      for (const cmt of detail.comments ?? []) {
        const cmtExisting = await q<{ local_comment_id: string }>(
          "select local_comment_id from import_map_comments where basecamp_comment_id = $1",
          [String(cmt.id)],
        );
        if (cmtExisting.rows[0]) continue;
        const createdComment = await createComment({
          threadId: localThreadId,
          contentHtml: cmt.content ?? "",
          authorUserProfileId: cmt.creator ? personMap.get(cmt.creator.id) ?? null : null,
          createdAt: cmt.created_at,
          source: "bc2_import",
        } as never);
        await q(
          "insert into import_map_comments (basecamp_comment_id, local_comment_id) values ($1, $2)",
          [String(cmt.id), (createdComment as { id: string }).id],
        );
      }
      await logRecord(q, {
        jobId,
        recordType: "thread",
        sourceId: String(t.id),
        status: "success",
        dataSource: detailRes.source,
      });
      success++;
    } catch (err) {
      await logRecord(q, {
        jobId,
        recordType: "thread",
        sourceId: String(t.id),
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
        dataSource,
      });
      failed++;
    }
  }

  return { threads: { success, failed, skipped } };
}
```

- [ ] **Step 7.5: Reconcile `createThread` / `createComment` signatures**

Open `lib/repositories.ts:1439` (`createThread`) and `:1554`
(`createComment`). Update the call sites in `threads.ts` to match
exactly. The authoritative call shape lives in
`scripts/migrate-bc2.ts:migrateThreadsAndComments`.

- [ ] **Step 7.6: Run tests**

```bash
pnpm vitest run tests/unit/migration-threads.test.ts
```

Expected: PASS.

- [ ] **Step 7.7: Commit**

```bash
git add lib/imports/migration/threads.ts tests/unit/migration-threads.test.ts
git commit -m "feat(migration): threads/comments phase reading dump"
```

---

## Task 8: Files migration (`lib/imports/migration/files.ts`)

**Files:**
- Create: `lib/imports/migration/files.ts`
- Test: `tests/unit/migration-files.test.ts`

Streams attachment binary from BC2 → Dropbox via existing
`importBc2FileFromAttachment`. The dump only stores attachment metadata;
the binary is always live BC2.

- [ ] **Step 8.1: Locate the old function**

`scripts/migrate-bc2.ts` → `async function migrateFiles(`. It builds a
`Bc2DownloadEnv`, iterates attachments, calls
`importBc2FileFromAttachment` per file.

- [ ] **Step 8.2: Write the failing test**

```ts
// tests/unit/migration-files.test.ts
import { describe, it, expect, vi } from "vitest";
import { migrateFiles } from "@/lib/imports/migration/files";
import type { Query } from "@/lib/imports/migration/jobs";
import type { DumpReader } from "@/lib/imports/dump-reader";

const importBc2FileFromAttachment = vi.fn(async () => ({ kind: "imported", localFileId: "f1" }));
vi.mock("@/lib/imports/bc2-migrate-single-file", () => ({
  importBc2FileFromAttachment,
}));

function stubReader(): DumpReader {
  return {
    people: vi.fn(),
    activeProjects: vi.fn(),
    archivedProjects: vi.fn(),
    topics: vi.fn(),
    topicDetail: vi.fn(),
    attachments: vi.fn(async () => ({
      source: "dump",
      body: [
        { id: 999, name: "doc.pdf", url: "https://basecamp.com/x/doc.pdf", byte_size: 100, content_type: "application/pdf" },
      ],
    })),
  } as unknown as DumpReader;
}

function fakeQuery(): Query {
  return (async () => ({ rows: [] })) as Query;
}

describe("migrateFiles", () => {
  it("calls importBc2FileFromAttachment once per attachment", async () => {
    const reader = stubReader();
    const q = fakeQuery();
    const out = await migrateFiles({
      reader,
      q,
      jobId: "job-1",
      project: { bc2Id: 100, localId: "proj-uuid", name: "X" },
      downloadEnv: { username: "u", password: "p", userAgent: "ua" },
      personMap: new Map(),
    });
    expect(importBc2FileFromAttachment).toHaveBeenCalledTimes(1);
    expect(out.files.success).toBe(1);
  });
});
```

- [ ] **Step 8.3: Run failing test**

```bash
pnpm vitest run tests/unit/migration-files.test.ts
```

Expected: FAIL.

- [ ] **Step 8.4: Implement `lib/imports/migration/files.ts`**

```ts
// lib/imports/migration/files.ts
import { importBc2FileFromAttachment } from "../bc2-migrate-single-file";
import type { Bc2DownloadEnv } from "../bc2-attachment-download";
import { logRecord, type Query, type DataSource } from "./jobs";
import type { DumpReader } from "../dump-reader";
import type { MigratedProject } from "./types";

interface Bc2AttachmentShape {
  id: number;
  url: string;
  name?: string;
  byte_size?: number;
  content_type?: string | null;
}

export async function migrateFiles(args: {
  reader: DumpReader;
  q: Query;
  jobId: string;
  project: MigratedProject;
  downloadEnv: Bc2DownloadEnv;
  personMap: Map<number, string>;
}): Promise<{ files: { success: number; failed: number } }> {
  const { reader, q, jobId, project, downloadEnv, personMap } = args;
  let success = 0;
  let failed = 0;

  const attRes = await reader.attachments(project.bc2Id);
  const attachments = (attRes.body ?? []) as Bc2AttachmentShape[];
  const dataSource: DataSource = attRes.source;

  for (const att of attachments) {
    try {
      const result = await importBc2FileFromAttachment({
        attachment: att as never,
        project: { bc2Id: project.bc2Id, localId: project.localId, name: project.name } as never,
        downloadEnv,
        query: q as never,
        personMap,
        jobId,
      } as never);
      const kind = (result as { kind?: string })?.kind ?? "unknown";
      success++;
      await logRecord(q, {
        jobId,
        recordType: "file",
        sourceId: String(att.id),
        status: "success",
        message: kind === "imported" ? null : `kind=${kind}`,
        dataSource,
      });
    } catch (err) {
      failed++;
      await logRecord(q, {
        jobId,
        recordType: "file",
        sourceId: String(att.id),
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
        dataSource,
      });
    }
  }
  return { files: { success, failed } };
}
```

- [ ] **Step 8.5: Reconcile `importBc2FileFromAttachment` signature**

Open `lib/imports/bc2-migrate-single-file.ts` and read
`ImportBc2FileFromAttachmentArgs`. Update the call inside `files.ts` to
match exactly. Cross-reference `migrateFiles` in
`scripts/migrate-bc2.ts` for the authoritative invocation.

- [ ] **Step 8.6: Run tests**

```bash
pnpm vitest run tests/unit/migration-files.test.ts
```

Expected: PASS.

- [ ] **Step 8.7: Commit**

```bash
git add lib/imports/migration/files.ts tests/unit/migration-files.test.ts
git commit -m "feat(migration): files phase streaming BC2 binaries to Dropbox"
```

---

## Task 9: Entry point script (`scripts/migrate-from-dump.ts`)

**Files:**
- Create: `scripts/migrate-from-dump.ts`
- Modify: `package.json`

- [ ] **Step 9.1: Write the script**

```ts
// scripts/migrate-from-dump.ts
import { config } from "dotenv";
import { resolve } from "path";
import { promises as fs } from "fs";
import * as path from "path";
import { Pool, type QueryResultRow } from "pg";
import { Bc2Client } from "../lib/imports/bc2-client";
import { createDumpReader } from "../lib/imports/dump-reader";
import {
  createImportJob,
  finishJob,
  incrementCounters,
  type Query,
} from "../lib/imports/migration/jobs";
import { migratePeople } from "../lib/imports/migration/people";
import { migrateProjects } from "../lib/imports/migration/projects";
import { migrateThreadsAndComments } from "../lib/imports/migration/threads";
import { migrateFiles } from "../lib/imports/migration/files";
import type { CliFlags, MigratedProject } from "../lib/imports/migration/types";

config({ path: resolve(process.cwd(), ".env.local") });

function parseFlags(): CliFlags {
  const argv = process.argv.slice(2);
  const flags: CliFlags = {
    phase: "all",
    projects: "all",
    limit: null,
    projectId: null,
    dumpDir: process.env.BASECAMP_DUMP_DIR ?? "/Volumes/Spare/basecamp-dump",
    dryRun: false,
    noFiles: false,
  };
  for (const a of argv) {
    if (a.startsWith("--phase=")) flags.phase = a.slice(8) as CliFlags["phase"];
    else if (a.startsWith("--projects=")) flags.projects = a.slice(11) as CliFlags["projects"];
    else if (a.startsWith("--limit=")) flags.limit = Number.parseInt(a.slice(8), 10);
    else if (a.startsWith("--project-id=")) flags.projectId = Number.parseInt(a.slice(13), 10);
    else if (a.startsWith("--dump-dir=")) flags.dumpDir = a.slice(11);
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--no-files") flags.noFiles = true;
    else throw new Error(`Unknown flag: ${a}`);
  }
  return flags;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function loadErrorsSet(dumpDir: string): Promise<Set<string>> {
  const p = path.join(dumpDir, "errors.json");
  try {
    const buf = await fs.readFile(p, "utf8");
    const arr = JSON.parse(buf) as Array<{ path: string }>;
    const set = new Set<string>();
    for (const e of arr) {
      const m = e.path.match(/^\/projects\/(\d+)\/(.+)$/);
      if (m) set.add(`by-project/${m[1]}/${m[2]}`);
      else if (e.path === "/projects.json") set.add("projects/active.json");
      else if (e.path === "/projects/archived.json") set.add("projects/archived.json");
      else if (e.path === "/people.json") set.add("people.json");
    }
    return set;
  } catch {
    return new Set();
  }
}

async function loadPersonMap(q: Query): Promise<Map<number, string>> {
  const r = await q<{ basecamp_person_id: string; local_user_profile_id: string }>(
    "select basecamp_person_id, local_user_profile_id from import_map_people",
  );
  const m = new Map<number, string>();
  for (const row of r.rows) m.set(Number(row.basecamp_person_id), row.local_user_profile_id);
  return m;
}

async function main(): Promise<void> {
  const flags = parseFlags();
  console.log(
    `[migrate-from-dump] dumpDir=${flags.dumpDir} phase=${flags.phase} ` +
    `projects=${flags.projects} dryRun=${flags.dryRun}`,
  );

  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL") });
  const realQ: Query = ((text: string, values?: unknown[]) =>
    pool.query(text, values).then(r => ({ rows: r.rows as QueryResultRow[] }))) as Query;
  const writableQ: Query = flags.dryRun
    ? (async (sql: string) => {
        if (sql.trim().toLowerCase().startsWith("select")) return realQ(sql);
        return { rows: [] };
      }) as Query
    : realQ;

  const accountId = process.env.BASECAMP_ACCOUNT_ID ?? requireEnv("BC2_ACCOUNT_ID");
  const username = requireEnv("BASECAMP_USERNAME");
  const password = requireEnv("BASECAMP_PASSWORD");
  const userAgent = process.env.BASECAMP_USER_AGENT ?? requireEnv("BC2_USER_AGENT");
  const client = new Bc2Client({ accountId, username, password, userAgent });

  const errors = await loadErrorsSet(flags.dumpDir);
  const reader = createDumpReader({ dumpDir: flags.dumpDir, client, errors });

  const jobId = await createImportJob(writableQ, {
    source: "dump",
    dumpDir: flags.dumpDir,
    flags,
  });
  console.log(`[migrate-from-dump] job=${jobId}`);

  let totalSuccess = 0;
  let totalFailed = 0;

  try {
    if (flags.phase === "all" || flags.phase === "people") {
      const r = await migratePeople({ reader, q: writableQ, jobId });
      totalSuccess += r.success;
      totalFailed += r.failed;
      console.log(`  people: success=${r.success} failed=${r.failed}`);
    }

    let migratedProjects: MigratedProject[] = [];
    const needsProjects =
      flags.phase === "all" ||
      flags.phase === "projects" ||
      flags.phase === "threads" ||
      flags.phase === "files";
    if (needsProjects) {
      const r = await migrateProjects({
        reader,
        q: writableQ,
        jobId,
        filter: flags.projects,
        limit: flags.limit,
        onlyProjectId: flags.projectId,
        knownClients: [],
      });
      migratedProjects = r.migrated;
      totalSuccess += migratedProjects.length;
      console.log(`  projects: ${migratedProjects.length}`);
    }

    if (flags.phase === "all" || flags.phase === "threads") {
      const personMap = await loadPersonMap(realQ);
      for (const p of migratedProjects) {
        const r = await migrateThreadsAndComments({
          reader,
          q: writableQ,
          jobId,
          project: p,
          personMap,
        });
        totalSuccess += r.threads.success;
        totalFailed += r.threads.failed;
        console.log(
          `  threads ${p.bc2Id}: ok=${r.threads.success} fail=${r.threads.failed} skip=${r.threads.skipped}`,
        );
      }
    }

    if (!flags.noFiles && (flags.phase === "all" || flags.phase === "files")) {
      const personMap = await loadPersonMap(realQ);
      const downloadEnv = { username, password, userAgent };
      for (const p of migratedProjects) {
        const r = await migrateFiles({
          reader,
          q: writableQ,
          jobId,
          project: p,
          downloadEnv,
          personMap,
        });
        totalSuccess += r.files.success;
        totalFailed += r.files.failed;
        console.log(`  files ${p.bc2Id}: ok=${r.files.success} fail=${r.files.failed}`);
      }
    }

    await incrementCounters(writableQ, jobId, totalSuccess, totalFailed);
    await finishJob(writableQ, jobId, "completed");
    console.log(
      `[migrate-from-dump] done. success=${totalSuccess} failed=${totalFailed}`,
    );
  } catch (err) {
    await finishJob(writableQ, jobId, "failed");
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error("[migrate-from-dump] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 9.2: Add npm script to `package.json`**

In the `scripts` block of `package.json`, after the existing
`"migrate:active"` line, add:

```json
"migrate:from-dump": "npx tsx scripts/migrate-from-dump.ts",
```

- [ ] **Step 9.3: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors. (`as never` casts are intentional pending the
signature reconciliation steps in 6.5 / 7.5 / 8.5.)

- [ ] **Step 9.4: Smoke (dry-run)**

```bash
pnpm migrate:from-dump --project-id=20190031 --dry-run --no-files
```

Expected: phase log lines printed, no DB writes (selects allowed),
finishes with `success=N failed=0`.

- [ ] **Step 9.5: Smoke (real, single project, no files)**

Pre-req: backup the dev DB (memory rule: backups required before any DB change).

```bash
pg_dump "$DATABASE_URL" > /tmp/backup-pre-migrate-from-dump.sql
pnpm migrate:from-dump --project-id=20190031 --no-files
```

Expected: project + threads + comments rows present. Check:

```bash
psql "$DATABASE_URL" -c "select data_source, count(*) from import_logs where job_id = (select id from import_jobs order by started_at desc limit 1) group by data_source"
```

Expected: `dump` count > `api` count.

- [ ] **Step 9.6: Smoke (with files)**

```bash
pnpm migrate:from-dump --project-id=20190031
```

Expected: file rows present, Dropbox folder for the test project
populated.

- [ ] **Step 9.7: Commit**

```bash
git add scripts/migrate-from-dump.ts package.json
git commit -m "feat(scripts): migrate-from-dump entry point"
```

---

## Task 10: Integration test

**Files:**
- Create: `tests/support/dump-fixture.ts`
- Create: `tests/integration/migrate-from-dump.test.ts`

- [ ] **Step 10.1: Write the dump fixture helper**

```ts
// tests/support/dump-fixture.ts
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

export async function makeFixtureDump(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bc2-fix-"));
  await fs.writeFile(
    path.join(dir, "people.json"),
    JSON.stringify([{ id: 1, email_address: "a@b.com", name: "Alice" }]),
  );
  await fs.mkdir(path.join(dir, "projects"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "projects", "active.json"),
    JSON.stringify([{ id: 1001, name: "ALG-001: Test", archived: false }]),
  );
  await fs.writeFile(path.join(dir, "projects", "archived.json"), JSON.stringify([]));
  const projectDir = path.join(dir, "by-project", "1001");
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "topics.json"),
    JSON.stringify([{ id: 5, title: "Hello", topicable: { id: 50, type: "Message" } }]),
  );
  await fs.mkdir(path.join(projectDir, "messages"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "messages", "50.json"),
    JSON.stringify({
      id: 50,
      subject: "Hello",
      content: "<p>hi</p>",
      creator: { id: 1 },
      comments: [{ id: 60, content: "<p>reply</p>", creator: { id: 1 } }],
    }),
  );
  await fs.writeFile(path.join(projectDir, "attachments.json"), JSON.stringify([]));
  return dir;
}
```

- [ ] **Step 10.2: Write the integration test**

The test invokes the script as a child process. We use
`child_process.spawnSync` with an argv array (no shell) to avoid command
injection from the temp-directory path.

```ts
// tests/integration/migrate-from-dump.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { Pool } from "pg";
import { makeFixtureDump } from "../support/dump-fixture";

const DB = process.env.DATABASE_URL_TEST;

describe.skipIf(!DB)("migrate-from-dump (integration)", () => {
  let dumpDir: string;
  let pool: Pool;

  beforeAll(async () => {
    dumpDir = await makeFixtureDump();
    pool = new Pool({ connectionString: DB });
    await pool.query("delete from import_logs");
    await pool.query("delete from import_jobs");
    await pool.query("delete from import_map_comments");
    await pool.query("delete from import_map_threads");
    await pool.query("delete from import_map_projects");
    await pool.query("delete from import_map_people");
    await pool.query("delete from discussion_comments where source = 'bc2_import'");
    await pool.query("delete from discussion_threads where source = 'bc2_import'");
    await pool.query("delete from projects where source = 'bc2_import'");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("runs end-to-end against a fixture dump (no files)", () => {
    const result = spawnSync(
      "npx",
      ["tsx", "scripts/migrate-from-dump.ts", `--dump-dir=${dumpDir}`, "--no-files"],
      { stdio: "inherit", env: { ...process.env, DATABASE_URL: DB } },
    );
    expect(result.status).toBe(0);
  });

  it("populated import_map_* and import_logs.data_source='dump'", async () => {
    const projects = await pool.query("select count(*)::int as c from import_map_projects");
    const threads = await pool.query("select count(*)::int as c from import_map_threads");
    const comments = await pool.query("select count(*)::int as c from import_map_comments");
    const sources = await pool.query(
      "select data_source, count(*)::int as c from import_logs group by data_source",
    );
    expect(projects.rows[0].c).toBe(1);
    expect(threads.rows[0].c).toBe(1);
    expect(comments.rows[0].c).toBe(1);
    expect(sources.rows.find((r: { data_source: string }) => r.data_source === "dump")?.c).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 10.3: Run integration test**

```bash
DATABASE_URL_TEST=postgres://... pnpm vitest run tests/integration/migrate-from-dump.test.ts
```

If `DATABASE_URL_TEST` is unset the test is skipped (matches the
project's existing convention).

Expected: PASS.

- [ ] **Step 10.4: Commit**

```bash
git add tests/support/dump-fixture.ts tests/integration/migrate-from-dump.test.ts
git commit -m "test(migration): integration test for migrate-from-dump"
```

---

## Task 11: Final verification

- [ ] **Step 11.1: Full unit test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 11.2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 11.3: Limited real run (5 projects)**

Pre-req: DB backup taken.

```bash
pg_dump "$DATABASE_URL" > /tmp/backup-pre-migrate-from-dump-batch.sql
pnpm migrate:from-dump --limit=5
```

Expected: completes; counts in `import_logs` show mostly
`data_source='dump'`; no errors in stderr.

- [ ] **Step 11.4: Inspect migration job**

```bash
psql "$DATABASE_URL" -c "select id, status, total_records, success_count, failed_count from import_jobs order by started_at desc limit 1"
psql "$DATABASE_URL" -c "select data_source, count(*) from import_logs group by data_source"
```

- [ ] **Step 11.5: Push branch + open PR**

```bash
git push -u origin feat/migrate-from-dump
gh pr create --title "feat: migrate from local BC2 dump with API fallback" \
  --body "$(cat <<'EOF'
## Summary
- New entry `scripts/migrate-from-dump.ts` reads from `/Volumes/Spare/basecamp-dump`.
- DumpReader resolves each request from disk, falls back to live BC2 API.
- New `lib/imports/migration/` modules (people/projects/threads/files) consume the reader.
- Adds `import_logs.data_source` column to track dump-vs-api per record.

## Test plan
- [ ] Unit tests pass (`pnpm test`)
- [ ] Type-check passes
- [ ] Integration test against fixture dump
- [ ] Single-project smoke run against dev DB
- [ ] Batch run with `--limit=5`
EOF
)"
```

---

## Self-Review

**Spec coverage check** (against `2026-05-05-migrate-from-dump-design.md`):

- New entry point — Task 9
- DumpReader abstraction — Task 4
- `lib/imports/migration/` modules — Tasks 2–8
- `import_logs.data_source` column — Task 1
- API fallback per record — DumpReader behavior in Task 4 + propagation through phases
- Streaming binary BC2 → Dropbox — Task 8 reuses `bc2-migrate-single-file`
- Idempotency via `import_map_*` — covered in projects/threads/files tasks
- Dry-run flag — Task 9
- Phased CLI — Task 9
- Unit + integration tests — Tasks 4–8 + 10
- Manual smoke sequence — Task 9 steps 9.4–9.6
- Old script untouched — verified by File Structure section

**Type consistency:** `Query`, `DataSource`, `MigratedProject`,
`DumpReader`, `DumpSource`, `CliFlags` are defined in Tasks 2–4 and used
identically in Tasks 5–9.

**Placeholder scan:** Tasks 6.5 / 7.5 / 8.5 explicitly call out the
signature-reconciliation step the engineer must perform — this is by
design (the actual call shape lives in `lib/repositories.ts` and
`bc2-migrate-single-file.ts` and a deliberate read-and-match step is
safer than a wrong guess in the plan).
