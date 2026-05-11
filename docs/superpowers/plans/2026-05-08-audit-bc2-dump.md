# Audit BC2 Dump Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only `scripts/audit-bc2-dump.ts` that compares the BC2 dump at `/Volumes/Spare/basecamp-dump/` against `import_map_*` and `import_logs`, classifies every expected entity (mapped, accounted-skip, accounted-fail, missing), and writes per-entity CSVs under `tmp/audit/`.

**Architecture:** Streaming reader builds the expected set per project; one batched DB load at startup hydrates in-memory maps for `import_map_*` and `import_logs`; classifier diffs each expected entity against those maps and writes a row to the appropriate CSV. No DB writes, no BC2 API calls, no migration code touched.

**Tech Stack:** TypeScript, Node 22, pnpm, vitest, pg, dotenv. Reuses existing dump shape produced by `scripts/dump-bc2.ts`.

**Spec:** `docs/superpowers/specs/2026-05-08-audit-bc2-dump-design.md`

---

## File Structure

**Created:**
- `scripts/audit-bc2-dump.ts`
- `lib/imports/audit/types.ts`
- `lib/imports/audit/reader.ts`
- `lib/imports/audit/diff.ts`
- `lib/imports/audit/csv-writer.ts`
- `tests/unit/audit-reader.test.ts`
- `tests/unit/audit-diff.test.ts`
- `tests/unit/audit-csv-writer.test.ts`

**Modified:**
- `package.json` (add `audit:bc2-dump` script)
- `.gitignore` (add `tmp/` if not already ignored)

**Untouched:**
- `scripts/migrate-from-dump.ts`, `scripts/migrate-bc2.ts`, all `lib/imports/migration/*`, all migration phase modules. **Per the spec's hard constraint, the audit must not invoke or modify migration code.**

---

## Task 0: Worktree + branch

**Files:** none

- [ ] **Step 0.1: Create worktree off main**

```bash
git worktree add .worktrees/audit-bc2-dump -b feat/audit-bc2-dump main
cd .worktrees/audit-bc2-dump
pnpm install
```

- [ ] **Step 0.2: Confirm dump exists**

```bash
ls /Volumes/Spare/basecamp-dump/people.json /Volumes/Spare/basecamp-dump/projects/active.json
```

Expected: both files present. If not, the audit cannot run (this is a recon-only branch — the dump itself was produced by a separate run).

- [ ] **Step 0.3: Confirm DB has post-migration data**

The audit needs `import_map_*` rows from the completed migration. Confirm with a single env-loaded query:

```bash
set -a; source .env.local; set +a
/opt/homebrew/opt/postgresql@17/bin/psql "$DATABASE_URL" -c "select count(*) from import_map_projects"
```

Expected: a positive integer (the migration filled this).

---

## Task 1: `.gitignore` — exclude `tmp/`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1.1: Check existing entry**

```bash
grep -n '^tmp' .gitignore
```

If a line for `tmp/` already exists, skip to Task 2.

- [ ] **Step 1.2: Append line**

Edit `.gitignore` and add at the end:

```
# Audit + ad-hoc tooling output
tmp/
```

- [ ] **Step 1.3: Verify ignore**

```bash
mkdir -p tmp/audit && touch tmp/audit/test.csv
git check-ignore -v tmp/audit/test.csv
rm -rf tmp/
```

Expected: `git check-ignore` prints the matching `.gitignore:N:tmp/` line.

- [ ] **Step 1.4: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore tmp/ for audit and ad-hoc tooling output"
```

---

## Task 2: Audit types (`lib/imports/audit/types.ts`)

**Files:**
- Create: `lib/imports/audit/types.ts`

- [ ] **Step 2.1: Write file**

```ts
// lib/imports/audit/types.ts

export type EntityKind = "people" | "projects" | "topics" | "comments" | "files";

export type EntityStatus =
  | "mapped"
  | "skipped_unsupported"
  | "skipped_existing"
  | "failed"
  | "missing";

export interface PeopleExpected {
  bc2Id: number;
  email: string;
  name: string;
}

export interface ProjectExpected {
  bc2Id: number;
  name: string;
  archived: boolean;
}

export interface TopicExpected {
  bc2ProjectId: number;
  bc2TopicId: number;
  topicableType: string;
  title: string;
}

export interface CommentExpected {
  bc2ProjectId: number;
  bc2TopicId: number;
  bc2CommentId: number;
}

export interface FileExpected {
  bc2ProjectId: number;
  bc2AttachmentId: number;
  filename: string;
  byteSize: number | null;
}

export interface DbState {
  // basecamp_*_id -> local_*_id
  peopleMap: Map<string, string>;
  projectsMap: Map<string, string>;
  threadsMap: Map<string, string>;
  commentsMap: Map<string, string>;
  filesMap: Map<string, string>;
  // (record_type, source_record_id) -> { status, message }
  logs: Map<string, { status: string; message: string | null }>;
}

export interface ClassifiedRow {
  status: EntityStatus;
  localId: string;
  reason: string;
}

export interface SummaryCounts {
  expected: number;
  mapped: number;
  accountedSkip: number;
  accountedFail: number;
  unaccounted: number;
}

export type SummaryByEntity = Record<EntityKind, SummaryCounts>;
```

- [ ] **Step 2.2: Commit**

```bash
git add lib/imports/audit/types.ts
git commit -m "feat(audit): shared types"
```

---

## Task 3: CSV writer (`lib/imports/audit/csv-writer.ts`)

**Files:**
- Create: `lib/imports/audit/csv-writer.ts`
- Test: `tests/unit/audit-csv-writer.test.ts`

- [ ] **Step 3.1: Write the failing test**

```ts
// tests/unit/audit-csv-writer.test.ts
import { describe, it, expect } from "vitest";
import { escapeCsvField, csvRow } from "@/lib/imports/audit/csv-writer";

describe("escapeCsvField", () => {
  it("returns plain text untouched", () => {
    expect(escapeCsvField("plain")).toBe("plain");
  });
  it("quotes fields with commas", () => {
    expect(escapeCsvField("a,b")).toBe("\"a,b\"");
  });
  it("quotes fields with newlines", () => {
    expect(escapeCsvField("line1\nline2")).toBe("\"line1\nline2\"");
  });
  it("quotes and doubles inner double-quotes", () => {
    expect(escapeCsvField("she said \"hi\"")).toBe("\"she said \"\"hi\"\"\"");
  });
  it("renders null and undefined as empty", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });
  it("renders numbers via String", () => {
    expect(escapeCsvField(42)).toBe("42");
  });
});

describe("csvRow", () => {
  it("joins escaped fields with commas and trailing newline", () => {
    expect(csvRow(["a", "b,c", null])).toBe("a,\"b,c\",\n");
  });
});
```

- [ ] **Step 3.2: Run failing test**

```bash
pnpm vitest run tests/unit/audit-csv-writer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement `lib/imports/audit/csv-writer.ts`**

```ts
// lib/imports/audit/csv-writer.ts
import { promises as fs } from "fs";
import * as path from "path";
import type { WriteStream } from "fs";
import { createWriteStream } from "fs";

export function escapeCsvField(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(",") + "\n";
}

export async function ensureOutDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export interface CsvHandle {
  path: string;
  stream: WriteStream;
  writeRow(fields: unknown[]): void;
  close(): Promise<void>;
}

export async function openCsv(
  outDir: string,
  filename: string,
  header: string[],
): Promise<CsvHandle> {
  const filePath = path.join(outDir, filename);
  const stream = createWriteStream(filePath, { encoding: "utf8" });
  stream.write(csvRow(header));
  return {
    path: filePath,
    stream,
    writeRow(fields) {
      stream.write(csvRow(fields));
    },
    close() {
      return new Promise((resolve, reject) => {
        stream.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
      });
    },
  };
}
```

- [ ] **Step 3.4: Run tests**

```bash
pnpm vitest run tests/unit/audit-csv-writer.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 3.5: Commit**

```bash
git add lib/imports/audit/csv-writer.ts tests/unit/audit-csv-writer.test.ts
git commit -m "feat(audit): RFC 4180 CSV writer"
```

---

## Task 4: Dump reader (`lib/imports/audit/reader.ts`)

**Files:**
- Create: `lib/imports/audit/reader.ts`
- Test: `tests/unit/audit-reader.test.ts`

This module exposes async functions that **return** (small entities) or
**stream via async generators** (large entities) the expected sets from
the dump. No DB access. No live BC2 API.

- [ ] **Step 4.1: Write the failing test**

```ts
// tests/unit/audit-reader.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "fs";
import * as path from "path";
import {
  readPeople,
  readProjects,
  readTopicsForProject,
  readCommentsForTopic,
  readAttachmentsForProject,
  listProjectIds,
} from "@/lib/imports/audit/reader";
import { makeFixtureDump } from "../support/dump-fixture";

describe("audit reader", () => {
  let dumpDir: string;

  beforeAll(async () => {
    dumpDir = await makeFixtureDump();
  });

  afterAll(async () => {
    await fs.rm(dumpDir, { recursive: true, force: true });
  });

  it("readPeople returns dump rows with ids", async () => {
    const people = await readPeople(dumpDir);
    expect(people).toEqual([{ bc2Id: 1, email: "a@b.com", name: "Alice" }]);
  });

  it("readProjects merges active + archived with archive flag", async () => {
    const projects = await readProjects(dumpDir);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ bc2Id: 1001, name: "ALG-001: Test", archived: false });
  });

  it("listProjectIds yields ids from by-project dirs", async () => {
    const ids = await listProjectIds(dumpDir);
    expect(ids).toEqual([1001]);
  });

  it("readTopicsForProject returns topic summaries", async () => {
    const topics = await readTopicsForProject(dumpDir, 1001);
    expect(topics).toEqual([
      {
        bc2ProjectId: 1001,
        bc2TopicId: 50,
        topicableType: "Message",
        title: "Hello",
      },
    ]);
  });

  it("readCommentsForTopic returns comments from the topic detail file", async () => {
    const comments = await readCommentsForTopic(dumpDir, 1001, "Message", 50);
    expect(comments).toEqual([
      { bc2ProjectId: 1001, bc2TopicId: 50, bc2CommentId: 60 },
    ]);
  });

  it("readAttachmentsForProject returns empty array when no attachments", async () => {
    const attachments = await readAttachmentsForProject(dumpDir, 1001);
    expect(attachments).toEqual([]);
  });

  it("readTopicsForProject returns empty array when topics.json missing", async () => {
    const ghostId = 9999;
    const topics = await readTopicsForProject(dumpDir, ghostId);
    expect(topics).toEqual([]);
  });
});
```

- [ ] **Step 4.2: Run failing test**

```bash
pnpm vitest run tests/unit/audit-reader.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement `lib/imports/audit/reader.ts`**

```ts
// lib/imports/audit/reader.ts
import { promises as fs } from "fs";
import * as path from "path";
import type {
  PeopleExpected,
  ProjectExpected,
  TopicExpected,
  CommentExpected,
  FileExpected,
} from "./types";

export const TOPICABLE_TYPE_TO_SEGMENT: Record<string, string> = {
  Message: "messages",
  Todolist: "todolists",
  CalendarEvent: "calendar_events",
  Calendar: "calendar_events",
  Upload: "uploads",
  Document: "documents",
};

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const buf = await fs.readFile(p, "utf8");
    if (buf.trim().length === 0) return null;
    return JSON.parse(buf) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

interface RawPerson {
  id: number;
  email_address?: string;
  name?: string;
}

interface RawProject {
  id: number;
  name?: string;
  archived?: boolean;
}

interface RawTopicSummary {
  id: number;
  title?: string;
  topicable: { id: number; type: string };
}

interface RawComment {
  id: number;
}

interface RawAttachment {
  id: number;
  name?: string;
  byte_size?: number;
}

interface RawTopicDetail {
  comments?: RawComment[];
}

export async function readPeople(dumpDir: string): Promise<PeopleExpected[]> {
  const data = (await readJson<RawPerson[]>(path.join(dumpDir, "people.json"))) ?? [];
  return data.map((p) => ({ bc2Id: p.id, email: p.email_address ?? "", name: p.name ?? "" }));
}

export async function readProjects(dumpDir: string): Promise<ProjectExpected[]> {
  const active = (await readJson<RawProject[]>(path.join(dumpDir, "projects", "active.json"))) ?? [];
  const archived = (await readJson<RawProject[]>(path.join(dumpDir, "projects", "archived.json"))) ?? [];
  return [
    ...active.map((p) => ({ bc2Id: p.id, name: p.name ?? "", archived: !!p.archived })),
    ...archived.map((p) => ({ bc2Id: p.id, name: p.name ?? "", archived: true })),
  ];
}

export async function listProjectIds(dumpDir: string): Promise<number[]> {
  const root = path.join(dumpDir, "by-project");
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries
    .map((e) => Number.parseInt(e, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

export async function readTopicsForProject(
  dumpDir: string,
  projectId: number,
): Promise<TopicExpected[]> {
  const data = (await readJson<RawTopicSummary[]>(
    path.join(dumpDir, "by-project", String(projectId), "topics.json"),
  )) ?? [];
  return data.map((t) => ({
    bc2ProjectId: projectId,
    bc2TopicId: t.topicable?.id ?? t.id,
    topicableType: t.topicable?.type ?? "",
    title: t.title ?? "",
  }));
}

export async function readCommentsForTopic(
  dumpDir: string,
  projectId: number,
  topicableType: string,
  topicId: number,
): Promise<CommentExpected[]> {
  const segment = TOPICABLE_TYPE_TO_SEGMENT[topicableType];
  if (!segment) return [];
  const data = (await readJson<RawTopicDetail>(
    path.join(dumpDir, "by-project", String(projectId), segment, `${topicId}.json`),
  )) ?? {};
  return (data.comments ?? []).map((c) => ({
    bc2ProjectId: projectId,
    bc2TopicId: topicId,
    bc2CommentId: c.id,
  }));
}

export async function readAttachmentsForProject(
  dumpDir: string,
  projectId: number,
): Promise<FileExpected[]> {
  const data = (await readJson<RawAttachment[]>(
    path.join(dumpDir, "by-project", String(projectId), "attachments.json"),
  )) ?? [];
  return data.map((a) => ({
    bc2ProjectId: projectId,
    bc2AttachmentId: a.id,
    filename: a.name ?? "",
    byteSize: a.byte_size ?? null,
  }));
}
```

- [ ] **Step 4.4: Run tests**

```bash
pnpm vitest run tests/unit/audit-reader.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 4.5: Commit**

```bash
git add lib/imports/audit/reader.ts tests/unit/audit-reader.test.ts
git commit -m "feat(audit): dump reader"
```

---

## Task 5: Diff classifier (`lib/imports/audit/diff.ts`)

**Files:**
- Create: `lib/imports/audit/diff.ts`
- Test: `tests/unit/audit-diff.test.ts`

- [ ] **Step 5.1: Write the failing test**

```ts
// tests/unit/audit-diff.test.ts
import { describe, it, expect } from "vitest";
import { classifyEntity, loadDbState } from "@/lib/imports/audit/diff";
import type { DbState } from "@/lib/imports/audit/types";

function emptyState(): DbState {
  return {
    peopleMap: new Map(),
    projectsMap: new Map(),
    threadsMap: new Map(),
    commentsMap: new Map(),
    filesMap: new Map(),
    logs: new Map(),
  };
}

describe("classifyEntity", () => {
  it("status=mapped when id present in the map", () => {
    const s = emptyState();
    s.projectsMap.set("100", "uuid-1");
    const out = classifyEntity({ kind: "projects", bc2Id: "100", state: s });
    expect(out).toEqual({ status: "mapped", localId: "uuid-1", reason: "" });
  });

  it("status=skipped_unsupported when log message starts with skipped_topicable_type=", () => {
    const s = emptyState();
    s.logs.set("thread:50", { status: "failed", message: "skipped_topicable_type=CalendarEvent" });
    const out = classifyEntity({ kind: "topics", bc2Id: "50", state: s });
    expect(out.status).toBe("skipped_unsupported");
    expect(out.reason).toBe("skipped_topicable_type=CalendarEvent");
  });

  it("status=skipped_existing when log message equals skipped_existing", () => {
    const s = emptyState();
    s.logs.set("file:777", { status: "success", message: "skipped_existing" });
    const out = classifyEntity({ kind: "files", bc2Id: "777", state: s });
    expect(out.status).toBe("skipped_existing");
    expect(out.reason).toBe("skipped_existing");
  });

  it("status=failed for other failed log entries, copies message to reason", () => {
    const s = emptyState();
    s.logs.set("file:778", { status: "failed", message: "Failed to parse URL from undefined" });
    const out = classifyEntity({ kind: "files", bc2Id: "778", state: s });
    expect(out.status).toBe("failed");
    expect(out.reason).toBe("Failed to parse URL from undefined");
  });

  it("status=missing when neither map nor log has the id", () => {
    const s = emptyState();
    const out = classifyEntity({ kind: "comments", bc2Id: "999", state: s });
    expect(out).toEqual({ status: "missing", localId: "", reason: "" });
  });

  it("uses the correct record_type prefix per entity kind", () => {
    const s = emptyState();
    s.logs.set("project:42", { status: "failed", message: "orphan" });
    const out = classifyEntity({ kind: "projects", bc2Id: "42", state: s });
    expect(out.status).toBe("failed");
    expect(out.reason).toBe("orphan");
  });
});

describe("loadDbState", () => {
  it("hydrates all five maps + logs map from query results", async () => {
    const calls: string[] = [];
    const fakeQ = (async <T>(sql: string): Promise<{ rows: T[] }> => {
      calls.push(sql.trim().split(/\s+/).slice(0, 4).join(" "));
      if (sql.includes("from import_map_people")) {
        return { rows: [{ basecamp_person_id: "1", local_user_profile_id: "u1" }] as T[] };
      }
      if (sql.includes("from import_map_projects")) {
        return { rows: [{ basecamp_project_id: "100", local_project_id: "p1" }] as T[] };
      }
      if (sql.includes("from import_map_threads")) {
        return { rows: [{ basecamp_thread_id: "50", local_thread_id: "t1" }] as T[] };
      }
      if (sql.includes("from import_map_comments")) {
        return { rows: [{ basecamp_comment_id: "60", local_comment_id: "c1" }] as T[] };
      }
      if (sql.includes("from import_map_files")) {
        return { rows: [{ basecamp_file_id: "70", local_file_id: "f1" }] as T[] };
      }
      if (sql.includes("from import_logs")) {
        return {
          rows: [
            { record_type: "thread", source_record_id: "999", status: "failed", message: "skipped_topicable_type=Todo" },
          ] as T[],
        };
      }
      return { rows: [] as T[] };
    }) as unknown as Parameters<typeof loadDbState>[0];

    const state = await loadDbState(fakeQ);

    expect(state.peopleMap.get("1")).toBe("u1");
    expect(state.projectsMap.get("100")).toBe("p1");
    expect(state.threadsMap.get("50")).toBe("t1");
    expect(state.commentsMap.get("60")).toBe("c1");
    expect(state.filesMap.get("70")).toBe("f1");
    expect(state.logs.get("thread:999")).toEqual({
      status: "failed",
      message: "skipped_topicable_type=Todo",
    });
    expect(calls.length).toBe(6);
  });
});
```

- [ ] **Step 5.2: Run failing test**

```bash
pnpm vitest run tests/unit/audit-diff.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement `lib/imports/audit/diff.ts`**

```ts
// lib/imports/audit/diff.ts
import type { ClassifiedRow, DbState, EntityKind } from "./types";

export type Query = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[] }>;

const KIND_TO_RECORD_TYPE: Record<EntityKind, string> = {
  people: "person",
  projects: "project",
  topics: "thread",
  comments: "comment",
  files: "file",
};

const KIND_TO_MAP: Record<EntityKind, keyof DbState> = {
  people: "peopleMap",
  projects: "projectsMap",
  topics: "threadsMap",
  comments: "commentsMap",
  files: "filesMap",
};

export function classifyEntity(args: {
  kind: EntityKind;
  bc2Id: string;
  state: DbState;
}): ClassifiedRow {
  const { kind, bc2Id, state } = args;
  const map = state[KIND_TO_MAP[kind]] as Map<string, string>;
  const mapped = map.get(bc2Id);
  if (mapped) {
    return { status: "mapped", localId: mapped, reason: "" };
  }
  const recordType = KIND_TO_RECORD_TYPE[kind];
  const log = state.logs.get(`${recordType}:${bc2Id}`);
  if (log) {
    const msg = log.message ?? "";
    if (msg.startsWith("skipped_topicable_type=")) {
      return { status: "skipped_unsupported", localId: "", reason: msg };
    }
    if (msg === "skipped_existing") {
      return { status: "skipped_existing", localId: "", reason: msg };
    }
    if (log.status === "failed") {
      return { status: "failed", localId: "", reason: msg };
    }
    // Successful log without a corresponding map entry — treat as missing.
    return { status: "missing", localId: "", reason: msg };
  }
  return { status: "missing", localId: "", reason: "" };
}

export async function loadDbState(q: Query): Promise<DbState> {
  const peopleMap = new Map<string, string>();
  const projectsMap = new Map<string, string>();
  const threadsMap = new Map<string, string>();
  const commentsMap = new Map<string, string>();
  const filesMap = new Map<string, string>();
  const logs = new Map<string, { status: string; message: string | null }>();

  const peopleRows = (
    await q<{ basecamp_person_id: string; local_user_profile_id: string }>(
      "select basecamp_person_id, local_user_profile_id from import_map_people",
    )
  ).rows;
  for (const r of peopleRows) peopleMap.set(r.basecamp_person_id, r.local_user_profile_id);

  const projectRows = (
    await q<{ basecamp_project_id: string; local_project_id: string }>(
      "select basecamp_project_id, local_project_id from import_map_projects",
    )
  ).rows;
  for (const r of projectRows) projectsMap.set(r.basecamp_project_id, r.local_project_id);

  const threadRows = (
    await q<{ basecamp_thread_id: string; local_thread_id: string }>(
      "select basecamp_thread_id, local_thread_id from import_map_threads",
    )
  ).rows;
  for (const r of threadRows) threadsMap.set(r.basecamp_thread_id, r.local_thread_id);

  const commentRows = (
    await q<{ basecamp_comment_id: string; local_comment_id: string }>(
      "select basecamp_comment_id, local_comment_id from import_map_comments",
    )
  ).rows;
  for (const r of commentRows) commentsMap.set(r.basecamp_comment_id, r.local_comment_id);

  const fileRows = (
    await q<{ basecamp_file_id: string; local_file_id: string }>(
      "select basecamp_file_id, local_file_id from import_map_files",
    )
  ).rows;
  for (const r of fileRows) filesMap.set(r.basecamp_file_id, r.local_file_id);

  // logs: latest status+message per (record_type, source_record_id).
  const logRows = (
    await q<{
      record_type: string;
      source_record_id: string;
      status: string;
      message: string | null;
    }>(
      `select distinct on (record_type, source_record_id)
         record_type, source_record_id, status, message
       from import_logs
       order by record_type, source_record_id, created_at desc`,
    )
  ).rows;
  for (const r of logRows) {
    logs.set(`${r.record_type}:${r.source_record_id}`, {
      status: r.status,
      message: r.message,
    });
  }

  return { peopleMap, projectsMap, threadsMap, commentsMap, filesMap, logs };
}
```

- [ ] **Step 5.4: Run tests**

```bash
pnpm vitest run tests/unit/audit-diff.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5.5: Commit**

```bash
git add lib/imports/audit/diff.ts tests/unit/audit-diff.test.ts
git commit -m "feat(audit): diff classifier and DB state loader"
```

---

## Task 6: Entry script (`scripts/audit-bc2-dump.ts`)

**Files:**
- Create: `scripts/audit-bc2-dump.ts`
- Modify: `package.json`

- [ ] **Step 6.1: Write the script**

```ts
// scripts/audit-bc2-dump.ts
import { config } from "dotenv";
import { resolve } from "path";
import { Pool } from "pg";
import {
  readPeople,
  readProjects,
  readTopicsForProject,
  readCommentsForTopic,
  readAttachmentsForProject,
  listProjectIds,
} from "../lib/imports/audit/reader";
import { classifyEntity, loadDbState, type Query } from "../lib/imports/audit/diff";
import { ensureOutDir, openCsv } from "../lib/imports/audit/csv-writer";
import type {
  EntityKind,
  SummaryByEntity,
  SummaryCounts,
} from "../lib/imports/audit/types";

config({ path: resolve(process.cwd(), ".env.local") });

interface CliFlags {
  dumpDir: string;
  outDir: string;
  verbose: boolean;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const flags: CliFlags = {
    dumpDir: process.env.BASECAMP_DUMP_DIR ?? "/Volumes/Spare/basecamp-dump",
    outDir: "tmp/audit",
    verbose: false,
  };
  for (const a of args) {
    if (a.startsWith("--dump-dir=")) flags.dumpDir = a.slice("--dump-dir=".length);
    else if (a.startsWith("--out-dir=")) flags.outDir = a.slice("--out-dir=".length);
    else if (a === "--verbose") flags.verbose = true;
    else throw new Error(`Unknown flag: ${a}`);
  }
  return flags;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function emptySummary(): SummaryByEntity {
  const fresh = (): SummaryCounts => ({
    expected: 0,
    mapped: 0,
    accountedSkip: 0,
    accountedFail: 0,
    unaccounted: 0,
  });
  return {
    people: fresh(),
    projects: fresh(),
    topics: fresh(),
    comments: fresh(),
    files: fresh(),
  };
}

function bumpSummary(summary: SummaryByEntity, kind: EntityKind, status: string): void {
  const c = summary[kind];
  c.expected++;
  switch (status) {
    case "mapped":
      c.mapped++;
      break;
    case "skipped_unsupported":
    case "skipped_existing":
      c.accountedSkip++;
      break;
    case "failed":
      c.accountedFail++;
      break;
    case "missing":
      c.unaccounted++;
      break;
  }
}

async function main(): Promise<void> {
  const flags = parseFlags();
  console.log(
    `[audit-bc2-dump] dumpDir=${flags.dumpDir} outDir=${flags.outDir}`,
  );

  await ensureOutDir(flags.outDir);

  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL") });
  pool.on("error", (err) => {
    console.warn(`[audit-bc2-dump] pool client error (non-fatal): ${err.message}`);
  });
  const q: Query = (async <T>(text: string, values?: unknown[]) => {
    const r = await pool.query(text, values);
    return { rows: r.rows as T[] };
  }) as Query;

  console.log("[audit-bc2-dump] loading DB state...");
  const state = await loadDbState(q);
  console.log(
    `[audit-bc2-dump] db: people=${state.peopleMap.size} projects=${state.projectsMap.size} ` +
    `threads=${state.threadsMap.size} comments=${state.commentsMap.size} ` +
    `files=${state.filesMap.size} logs=${state.logs.size}`,
  );

  const summary = emptySummary();

  // people
  const peopleCsv = await openCsv(flags.outDir, "people.csv", [
    "bc2_id", "email", "name", "status", "local_user_profile_id", "reason",
  ]);
  for (const p of await readPeople(flags.dumpDir)) {
    const c = classifyEntity({ kind: "people", bc2Id: String(p.bc2Id), state });
    bumpSummary(summary, "people", c.status);
    peopleCsv.writeRow([p.bc2Id, p.email, p.name, c.status, c.localId, c.reason]);
  }
  await peopleCsv.close();

  // projects
  const projectsCsv = await openCsv(flags.outDir, "projects.csv", [
    "bc2_id", "name", "archived", "status", "local_project_id", "reason",
  ]);
  const projects = await readProjects(flags.dumpDir);
  for (const p of projects) {
    const c = classifyEntity({ kind: "projects", bc2Id: String(p.bc2Id), state });
    bumpSummary(summary, "projects", c.status);
    projectsCsv.writeRow([p.bc2Id, p.name, p.archived, c.status, c.localId, c.reason]);
  }
  await projectsCsv.close();

  // topics + comments + files (per project)
  const topicsCsv = await openCsv(flags.outDir, "topics.csv", [
    "bc2_project_id", "bc2_topic_id", "topicable_type", "title", "status", "local_thread_id", "reason",
  ]);
  const commentsCsv = await openCsv(flags.outDir, "comments.csv", [
    "bc2_project_id", "bc2_topic_id", "bc2_comment_id", "status", "local_comment_id", "reason",
  ]);
  const filesCsv = await openCsv(flags.outDir, "files.csv", [
    "bc2_project_id", "bc2_attachment_id", "filename", "byte_size", "status", "local_file_id", "reason",
  ]);

  const projectIds = await listProjectIds(flags.dumpDir);
  const total = projectIds.length;
  let pIdx = 0;
  const startMs = Date.now();

  for (const projectId of projectIds) {
    pIdx++;
    if (flags.verbose || pIdx % 100 === 0) {
      const elapsed = Math.round((Date.now() - startMs) / 1000);
      console.log(`[audit-bc2-dump] project ${pIdx}/${total} (${elapsed}s)`);
    }

    const topics = await readTopicsForProject(flags.dumpDir, projectId);
    for (const t of topics) {
      const c = classifyEntity({ kind: "topics", bc2Id: String(t.bc2TopicId), state });
      bumpSummary(summary, "topics", c.status);
      topicsCsv.writeRow([
        t.bc2ProjectId, t.bc2TopicId, t.topicableType, t.title, c.status, c.localId, c.reason,
      ]);

      const comments = await readCommentsForTopic(
        flags.dumpDir, t.bc2ProjectId, t.topicableType, t.bc2TopicId,
      );
      for (const com of comments) {
        const cc = classifyEntity({ kind: "comments", bc2Id: String(com.bc2CommentId), state });
        bumpSummary(summary, "comments", cc.status);
        commentsCsv.writeRow([
          com.bc2ProjectId, com.bc2TopicId, com.bc2CommentId, cc.status, cc.localId, cc.reason,
        ]);
      }
    }

    const attachments = await readAttachmentsForProject(flags.dumpDir, projectId);
    for (const a of attachments) {
      const c = classifyEntity({ kind: "files", bc2Id: String(a.bc2AttachmentId), state });
      bumpSummary(summary, "files", c.status);
      filesCsv.writeRow([
        a.bc2ProjectId, a.bc2AttachmentId, a.filename, a.byteSize ?? "", c.status, c.localId, c.reason,
      ]);
    }
  }

  await topicsCsv.close();
  await commentsCsv.close();
  await filesCsv.close();

  // summary
  const summaryCsv = await openCsv(flags.outDir, "summary.csv", [
    "entity", "expected", "mapped", "accounted_skip", "accounted_fail", "unaccounted",
  ]);
  const order: EntityKind[] = ["people", "projects", "topics", "comments", "files"];
  for (const kind of order) {
    const c = summary[kind];
    summaryCsv.writeRow([kind, c.expected, c.mapped, c.accountedSkip, c.accountedFail, c.unaccounted]);
  }
  await summaryCsv.close();

  await pool.end();

  console.log("[audit-bc2-dump] done.");
  for (const kind of order) {
    const c = summary[kind];
    console.log(
      `  ${kind.padEnd(9)} expected=${c.expected} mapped=${c.mapped} ` +
      `skip=${c.accountedSkip} fail=${c.accountedFail} unaccounted=${c.unaccounted}`,
    );
  }
}

main().catch((err) => {
  console.error("[audit-bc2-dump] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 6.2: Add npm script to `package.json`**

After the existing `"migrate:from-dump":` line, insert:

```json
"audit:bc2-dump": "npx tsx scripts/audit-bc2-dump.ts",
```

- [ ] **Step 6.3: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no new errors. If errors exist, fix before proceeding.

- [ ] **Step 6.4: Smoke (dump only, no DB)**

To verify the script wires up before any real DB run, point `DATABASE_URL` at an empty test DB (or use a tiny fixture dump) and check the output structure. Operator-driven step:

```bash
pnpm audit:bc2-dump --dump-dir=/Volumes/Spare/basecamp-dump --out-dir=tmp/audit-smoke 2>&1 | tail -20
ls -lh tmp/audit-smoke/
head tmp/audit-smoke/summary.csv
```

The script is read-only, so this is safe. Expected: 6 CSVs, `summary.csv` with the 5 entity rows, `unaccounted` columns reflecting reality.

- [ ] **Step 6.5: Commit**

```bash
git add scripts/audit-bc2-dump.ts package.json
git commit -m "feat(scripts): audit-bc2-dump entry point"
```

---

## Task 7: Final verification + push

- [ ] **Step 7.1: Full unit test suite**

```bash
pnpm vitest run
```

Expected: all tests pass (audit tests + all prior tests). No failures.

- [ ] **Step 7.2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7.3: Fallow dead-code check**

```bash
pnpm exec fallow dead-code
```

Expected: zero issues. If new exported symbols are flagged, drop the
`export` keyword on internal-only declarations (same pattern used on
the migration branch).

- [ ] **Step 7.4: Push branch**

```bash
git push -u origin feat/audit-bc2-dump
```

- [ ] **Step 7.5: Open PR**

```bash
gh pr create --title "feat: BC2 dump audit (CSV diff vs import_map_*)" --body "$(cat <<'EOF'
## Summary
- Read-only audit tool: \`scripts/audit-bc2-dump.ts\`.
- Compares the BC2 dump against \`import_map_*\` and \`import_logs\`.
- Writes per-entity CSVs to \`tmp/audit/\` with status (\`mapped\` / \`skipped_unsupported\` / \`skipped_existing\` / \`failed\` / \`missing\`).
- Zero DB writes, zero BC2 API calls, no migration code modified.

## Test plan
- [ ] \`pnpm test\`
- [ ] \`pnpm tsc --noEmit\`
- [ ] \`pnpm exec fallow dead-code\`
- [ ] \`pnpm audit:bc2-dump\` against the live dump+DB
- [ ] Review \`tmp/audit/summary.csv\` and confirm \`unaccounted\` is small or zero

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage check** (against `2026-05-08-audit-bc2-dump-design.md`):

- File layout (scripts/audit-bc2-dump.ts + lib/imports/audit/{reader,diff,csv-writer,types}.ts) — Tasks 2–6
- Output CSV schemas (people, projects, topics, comments, files, summary) — Task 6 emits all six with the documented column orders
- Diff algorithm (build expected sets, batch-load DB state, classify, write streaming, summary at end) — Tasks 4 (reader), 5 (diff), 6 (orchestration)
- CLI flags (`--dump-dir`, `--out-dir`, `--verbose`) and npm script — Task 6
- Error handling: read-only, ENOENT swallow only on optional files, fatal on DB connect or required files — Task 4 (`readJson` swallows ENOENT, `readPeople`/`readProjects` use it for required files but classification handles emptiness via expected sets being empty), Task 6 (Pool error handler logs but does not crash; unhandled query failures still throw and exit 1)
- Test coverage (reader / diff / csv-writer unit tests) — Tasks 3, 4, 5
- Hard constraint (no migration code modified) — File Structure section explicitly notes this
- gitignore tmp/ — Task 1

**Type consistency:** `EntityKind`, `EntityStatus`, `DbState`, `ClassifiedRow`, `SummaryCounts`, `SummaryByEntity`, `Query` are defined once in Task 2 / Task 5 and reused unchanged in later tasks. Field names (`bc2Id`, `localId`, `reason`, `status`) are stable across types and CSV columns.

**Placeholder scan:** No "TBD"/"TODO"/"implement later" anywhere. Every step shows code or exact commands. Every test has a runnable test body. CSV column names and order match the spec verbatim.
