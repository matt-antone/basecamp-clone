# Reconcile Prod-Active Projects Into Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `scripts/reconcile-prod-active-to-test.ts` that performs a one-way prod → test sync for prod-active projects, inserting prod-only files / discussions / comments into test by content fingerprint while dropping pre-creation orphans.

**Architecture:** Two `pg.Pool` connections (read-only prod, read-write test). Per-project transactions on test pool. Identity bridges via `bc2_projects_map` / `bc2_people_map` / `clients.code`. Three pure fingerprint functions drive a side-effect-free diff. Auditable via new `reconcile_jobs` / `reconcile_logs` tables and six CSV artifacts.

**Tech Stack:** TypeScript, `pg`, `tsx`, vitest. No ORM. Existing project conventions (supabase/migrations/, lib/imports/, tests/unit/, tests/integration/).

**Spec:** `docs/superpowers/specs/2026-05-05-reconcile-prod-active-to-test-design.md`

---

### Task 0: Inspect schemas

Before writing code, capture the prod-side and test-side column lists for tables we'll touch so later tasks can use exact column names.

**Files:**
- Read-only: query both DBs

- [ ] **Step 1: Dump column metadata for relevant tables**

Run, with `DATABASE_URL` pointing at test DB:

```bash
psql "$DATABASE_URL" -c "\d projects" \
  -c "\d project_files" \
  -c "\d threads" \
  -c "\d comments" \
  -c "\d users" \
  -c "\d clients" \
  -c "\d bc2_projects_map" \
  -c "\d bc2_people_map" \
  > tmp/test-schema.txt
```

Repeat against `PROD_DATABASE_URL`:

```bash
psql "$PROD_DATABASE_URL" -c "\d projects" \
  -c "\d project_files" \
  -c "\d threads" \
  -c "\d comments" \
  -c "\d users" \
  -c "\d clients" \
  -c "\d bc2_projects_map" \
  -c "\d bc2_people_map" \
  > tmp/prod-schema.txt
```

- [ ] **Step 2: Diff schemas, record findings**

Run:
```bash
diff tmp/prod-schema.txt tmp/test-schema.txt > tmp/schema-diff.txt
```

If `diff` is non-empty, list the differing columns in a comment in the spec's "Open questions / risks" section under a new "Schema drift findings" subsection. Any column required for insert that exists in prod but not test → STOP and raise with the user before continuing. Any test-only column that lacks a default → same.

If `diff` is empty, append `Schema drift findings: none (verified <date>)` to the spec.

- [ ] **Step 3: Commit notes**

```bash
git add docs/superpowers/specs/2026-05-05-reconcile-prod-active-to-test-design.md
git commit -m "docs(reconcile): record prod/test schema-drift verification"
```

---

### Task 1: Schema migration `0030_reconcile_logs`

**Files:**
- Create: `supabase/migrations/0030_reconcile_logs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0030_reconcile_logs.sql
-- Tables for the prod->test active-project reconcile script.

CREATE TABLE IF NOT EXISTS reconcile_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','completed','failed','interrupted')),
  dry_run boolean NOT NULL,
  summary_json jsonb
);

CREATE TABLE IF NOT EXISTS reconcile_logs (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES reconcile_jobs(id) ON DELETE CASCADE,
  project_bc2_id bigint,
  phase text NOT NULL CHECK (phase IN ('project','file','discussion','comment')),
  action text NOT NULL CHECK (action IN ('inserted','duplicate','orphan','skipped','error')),
  prod_id bigint,
  test_id bigint,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reconcile_logs_job_id_idx ON reconcile_logs(job_id);
CREATE INDEX IF NOT EXISTS reconcile_logs_project_bc2_id_idx ON reconcile_logs(project_bc2_id);
```

- [ ] **Step 2: Apply migration to test DB**

```bash
psql "$DATABASE_URL" -f supabase/migrations/0030_reconcile_logs.sql
```

Expected: `CREATE TABLE` x2, `CREATE INDEX` x2, no errors.

- [ ] **Step 3: Verify**

```bash
psql "$DATABASE_URL" -c "\d reconcile_jobs" -c "\d reconcile_logs"
```

Expected: both tables present with expected columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0030_reconcile_logs.sql
git commit -m "feat(db): add reconcile_jobs and reconcile_logs tables"
```

---

### Task 2: Types module

**Files:**
- Create: `lib/imports/reconcile/types.ts`

- [ ] **Step 1: Write the file**

```ts
// lib/imports/reconcile/types.ts

export interface CliFlags {
  projectId: number | null;     // bc2_id, not local id
  limit: number | null;
  dryRun: boolean;
  outDir: string;
}

export interface ProdProject {
  id: number;
  bc2_id: number;
  title: string;
  client_id: number;
  client_code: string;
  slug: string;
  description: string | null;
  archived: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TestProject {
  id: number;
  bc2_id: number;
  client_id: number;
  created_at: Date;
}

export interface FileRow {
  id: number;
  project_id: number;
  uploader_id: number;
  filename: string;
  size: number;
  mime_type: string | null;
  dropbox_path: string | null;
  created_at: Date;
}

export interface DiscussionRow {
  id: number;
  project_id: number;
  author_id: number;
  title: string;
  body: string | null;
  created_at: Date;
}

export interface CommentRow {
  id: number;
  thread_id: number;
  author_id: number;
  body: string | null;
  created_at: Date;
}

export interface ReconcileSummary {
  startedAt: string;
  finishedAt: string | null;
  dryRun: boolean;
  prodActiveTotal: number;
  unmappedProjects: number;
  unresolvedClient: number;
  syncedProjects: number;
  newTestProjects: number;
  files:       { inserted: number; duplicate: number; orphan: number };
  discussions: { inserted: number; duplicate: number; orphan: number };
  comments:    { inserted: number; duplicate: number; orphan: number };
  peopleSkips: number;
  walltimeMs: number;
}
```

> **Note on column names:** the FileRow / DiscussionRow / CommentRow shapes above are the contract this plan assumes. If Task 0's schema diff shows different column names (e.g. `name` instead of `filename`, `body_md` instead of `body`), update this file AND every later code block in this plan that references those columns. Do this once, here, before proceeding.

- [ ] **Step 2: Commit**

```bash
git add lib/imports/reconcile/types.ts
git commit -m "feat(reconcile): types module"
```

---

### Task 3: Fingerprints — failing test

**Files:**
- Create: `tests/unit/reconcile/fingerprints.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/reconcile/fingerprints.test.ts
import { describe, it, expect } from "vitest";
import {
  fileFpA,
  fileFpB,
  discussionFp,
  commentFp,
  normalizeBody,
  toIsoMs,
} from "@/lib/imports/reconcile/fingerprints";

describe("fingerprints", () => {
  const t = new Date("2026-05-01T12:34:56.789Z");

  describe("toIsoMs", () => {
    it("returns ms-precision iso string", () => {
      expect(toIsoMs(t)).toBe("2026-05-01T12:34:56.789Z");
    });
  });

  describe("normalizeBody", () => {
    it("converts CRLF to LF", () => {
      expect(normalizeBody("a\r\nb")).toBe("a\nb");
    });
    it("trims trailing whitespace", () => {
      expect(normalizeBody("hello   \n  ")).toBe("hello");
    });
    it("treats null as empty", () => {
      expect(normalizeBody(null)).toBe("");
    });
  });

  describe("fileFpA", () => {
    it("combines filename, size, created_at", () => {
      expect(fileFpA({ filename: "x.pdf", size: 1024, created_at: t } as any))
        .toBe("x.pdf|1024|2026-05-01T12:34:56.789Z");
    });
  });

  describe("fileFpB", () => {
    it("returns dropbox_path", () => {
      expect(fileFpB({ dropbox_path: "/a/b" } as any)).toBe("/a/b");
    });
    it("returns null when path missing", () => {
      expect(fileFpB({ dropbox_path: null } as any)).toBeNull();
    });
  });

  describe("discussionFp", () => {
    it("normalizes body before hashing", () => {
      const a = discussionFp({ title: "T", body: "hi\r\n", created_at: t } as any);
      const b = discussionFp({ title: "T", body: "hi", created_at: t } as any);
      expect(a).toBe(b);
    });
    it("differs when title differs", () => {
      const a = discussionFp({ title: "T", body: "x", created_at: t } as any);
      const b = discussionFp({ title: "U", body: "x", created_at: t } as any);
      expect(a).not.toBe(b);
    });
  });

  describe("commentFp", () => {
    it("includes mapped author id", () => {
      const a = commentFp({ body: "hi", author_test_user_id: 7, created_at: t } as any);
      const b = commentFp({ body: "hi", author_test_user_id: 8, created_at: t } as any);
      expect(a).not.toBe(b);
    });
    it("normalizes body", () => {
      const a = commentFp({ body: "x\r\n", author_test_user_id: 1, created_at: t } as any);
      const b = commentFp({ body: "x", author_test_user_id: 1, created_at: t } as any);
      expect(a).toBe(b);
    });
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm test tests/unit/reconcile/fingerprints.test.ts`

Expected: FAIL with "Cannot find module '@/lib/imports/reconcile/fingerprints'".

---

### Task 4: Fingerprints — implementation

**Files:**
- Create: `lib/imports/reconcile/fingerprints.ts`

- [ ] **Step 1: Write minimal implementation**

```ts
// lib/imports/reconcile/fingerprints.ts
import { createHash } from "node:crypto";
import type { FileRow, DiscussionRow } from "./types";

export function toIsoMs(d: Date): string {
  // Truncate sub-millisecond precision.
  const ms = Math.floor(d.getTime());
  return new Date(ms).toISOString();
}

export function normalizeBody(body: string | null | undefined): string {
  if (body == null) return "";
  return body.replace(/\r\n/g, "\n").replace(/\s+$/g, "");
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function fileFpA(f: Pick<FileRow, "filename" | "size" | "created_at">): string {
  return `${f.filename}|${f.size}|${toIsoMs(f.created_at)}`;
}

export function fileFpB(f: Pick<FileRow, "dropbox_path">): string | null {
  return f.dropbox_path ?? null;
}

export function discussionFp(
  d: Pick<DiscussionRow, "title" | "body" | "created_at">,
): string {
  return `${d.title}|${sha256(normalizeBody(d.body))}|${toIsoMs(d.created_at)}`;
}

export function commentFp(c: {
  body: string | null;
  author_test_user_id: number;
  created_at: Date;
}): string {
  return `${sha256(normalizeBody(c.body))}|${c.author_test_user_id}|${toIsoMs(c.created_at)}`;
}
```

- [ ] **Step 2: Run, expect pass**

Run: `pnpm test tests/unit/reconcile/fingerprints.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/imports/reconcile/fingerprints.ts tests/unit/reconcile/fingerprints.test.ts
git commit -m "feat(reconcile): fingerprint functions"
```

---

### Task 5: Orphan filter — failing test

**Files:**
- Create: `tests/unit/reconcile/orphan-filter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/reconcile/orphan-filter.test.ts
import { describe, it, expect } from "vitest";
import { applyOrphanFilter } from "@/lib/imports/reconcile/orphan-filter";

describe("applyOrphanFilter", () => {
  const project = { created_at: new Date("2026-01-15T00:00:00Z") };

  it("drops items strictly before project.created_at", () => {
    const items = [
      { id: 1, created_at: new Date("2026-01-14T23:59:59Z") },
      { id: 2, created_at: new Date("2026-01-15T00:00:00Z") },
      { id: 3, created_at: new Date("2026-01-16T00:00:00Z") },
    ];
    const r = applyOrphanFilter(items, project);
    expect(r.dropped.map((x) => x.id)).toEqual([1]);
    expect(r.kept.map((x) => x.id)).toEqual([2, 3]);
  });

  it("keeps everything when project is at epoch", () => {
    const items = [{ id: 1, created_at: new Date("2026-01-01T00:00:00Z") }];
    const r = applyOrphanFilter(items, { created_at: new Date(0) });
    expect(r.dropped).toEqual([]);
    expect(r.kept.length).toBe(1);
  });

  it("returns empty arrays for empty input", () => {
    const r = applyOrphanFilter([], project);
    expect(r).toEqual({ kept: [], dropped: [] });
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm test tests/unit/reconcile/orphan-filter.test.ts`

Expected: FAIL ("Cannot find module").

---

### Task 6: Orphan filter — implementation

**Files:**
- Create: `lib/imports/reconcile/orphan-filter.ts`

- [ ] **Step 1: Write implementation**

```ts
// lib/imports/reconcile/orphan-filter.ts

export function applyOrphanFilter<T extends { created_at: Date }>(
  items: T[],
  project: { created_at: Date },
): { kept: T[]; dropped: T[] } {
  const cutoff = project.created_at.getTime();
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items) {
    if (item.created_at.getTime() < cutoff) dropped.push(item);
    else kept.push(item);
  }
  return { kept, dropped };
}
```

- [ ] **Step 2: Run, expect pass**

Run: `pnpm test tests/unit/reconcile/orphan-filter.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/imports/reconcile/orphan-filter.ts tests/unit/reconcile/orphan-filter.test.ts
git commit -m "feat(reconcile): orphan cutoff filter"
```

---

### Task 7: Diff module — failing test

**Files:**
- Create: `tests/unit/reconcile/diff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/reconcile/diff.test.ts
import { describe, it, expect } from "vitest";
import {
  diffFiles,
  diffDiscussions,
  diffComments,
} from "@/lib/imports/reconcile/diff";

const t = new Date("2026-04-01T00:00:00Z");

describe("diffFiles", () => {
  it("matches by fpA (filename+size+created_at)", () => {
    const prod = [{ id: 10, filename: "a.pdf", size: 1, dropbox_path: "/p/a", created_at: t }];
    const test = [{ id: 99, filename: "a.pdf", size: 1, dropbox_path: "/different", created_at: t }];
    const r = diffFiles(prod as any, test as any);
    expect(r.toInsert).toEqual([]);
    expect(r.duplicates[0]).toMatchObject({ prodId: 10, testId: 99, matchedBy: "fpA" });
  });

  it("matches by fpB (dropbox_path) when fpA differs", () => {
    const prod = [{ id: 10, filename: "renamed.pdf", size: 2, dropbox_path: "/p/a", created_at: t }];
    const test = [{ id: 99, filename: "a.pdf", size: 1, dropbox_path: "/p/a", created_at: t }];
    const r = diffFiles(prod as any, test as any);
    expect(r.toInsert).toEqual([]);
    expect(r.duplicates[0].matchedBy).toBe("fpB");
  });

  it("returns prod-only items when neither key matches", () => {
    const prod = [{ id: 10, filename: "x.pdf", size: 1, dropbox_path: "/p/x", created_at: t }];
    const test = [{ id: 99, filename: "y.pdf", size: 2, dropbox_path: "/p/y", created_at: t }];
    const r = diffFiles(prod as any, test as any);
    expect(r.toInsert.map((f) => f.id)).toEqual([10]);
    expect(r.duplicates).toEqual([]);
  });

  it("treats null dropbox_path as never matching by fpB", () => {
    const prod = [{ id: 10, filename: "x.pdf", size: 1, dropbox_path: null, created_at: t }];
    const test = [{ id: 99, filename: "x.pdf", size: 1, dropbox_path: null, created_at: t }];
    const r = diffFiles(prod as any, test as any);
    expect(r.toInsert).toEqual([]);
    expect(r.duplicates[0].matchedBy).toBe("fpA");
  });
});

describe("diffDiscussions", () => {
  it("matches identical title+body+ts", () => {
    const prod = [{ id: 1, title: "T", body: "x", created_at: t }];
    const test = [{ id: 99, title: "T", body: "x", created_at: t }];
    const r = diffDiscussions(prod as any, test as any);
    expect(r.toInsert).toEqual([]);
    expect(r.duplicates[0]).toMatchObject({ prodId: 1, testId: 99 });
  });
  it("inserts when body differs", () => {
    const prod = [{ id: 1, title: "T", body: "x", created_at: t }];
    const test = [{ id: 99, title: "T", body: "y", created_at: t }];
    const r = diffDiscussions(prod as any, test as any);
    expect(r.toInsert.map((d) => d.id)).toEqual([1]);
  });
});

describe("diffComments", () => {
  it("dedupes by body+author_test_user_id+ts", () => {
    const prod = [{ id: 1, body: "yo", author_test_user_id: 5, created_at: t }];
    const test = [{ id: 99, body: "yo", author_test_user_id: 5, created_at: t }];
    const r = diffComments(prod as any, test as any);
    expect(r.toInsert).toEqual([]);
    expect(r.duplicates).toHaveLength(1);
  });
  it("treats different mapped authors as different", () => {
    const prod = [{ id: 1, body: "yo", author_test_user_id: 5, created_at: t }];
    const test = [{ id: 99, body: "yo", author_test_user_id: 6, created_at: t }];
    const r = diffComments(prod as any, test as any);
    expect(r.toInsert.map((c) => c.id)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm test tests/unit/reconcile/diff.test.ts`
Expected: FAIL ("Cannot find module").

---

### Task 8: Diff module — implementation

**Files:**
- Create: `lib/imports/reconcile/diff.ts`

- [ ] **Step 1: Write implementation**

```ts
// lib/imports/reconcile/diff.ts
import { fileFpA, fileFpB, discussionFp, commentFp } from "./fingerprints";
import type { FileRow, DiscussionRow } from "./types";

export interface DiffResult<ProdItem> {
  toInsert: ProdItem[];
  duplicates: { prodId: number; testId: number; matchedBy: string }[];
}

export function diffFiles(
  prod: FileRow[],
  test: FileRow[],
): DiffResult<FileRow> {
  const aIndex = new Map<string, number>();
  const bIndex = new Map<string, number>();
  for (const t of test) {
    aIndex.set(fileFpA(t), t.id);
    const b = fileFpB(t);
    if (b !== null) bIndex.set(b, t.id);
  }
  const toInsert: FileRow[] = [];
  const duplicates: DiffResult<FileRow>["duplicates"] = [];
  for (const p of prod) {
    const a = fileFpA(p);
    const b = fileFpB(p);
    const aHit = aIndex.get(a);
    const bHit = b !== null ? bIndex.get(b) : undefined;
    if (aHit !== undefined) {
      duplicates.push({ prodId: p.id, testId: aHit, matchedBy: "fpA" });
    } else if (bHit !== undefined) {
      duplicates.push({ prodId: p.id, testId: bHit, matchedBy: "fpB" });
    } else {
      toInsert.push(p);
    }
  }
  return { toInsert, duplicates };
}

export function diffDiscussions(
  prod: DiscussionRow[],
  test: DiscussionRow[],
): DiffResult<DiscussionRow> {
  const idx = new Map<string, number>();
  for (const t of test) idx.set(discussionFp(t), t.id);
  const toInsert: DiscussionRow[] = [];
  const duplicates: DiffResult<DiscussionRow>["duplicates"] = [];
  for (const p of prod) {
    const fp = discussionFp(p);
    const hit = idx.get(fp);
    if (hit !== undefined) {
      duplicates.push({ prodId: p.id, testId: hit, matchedBy: "discussionFp" });
    } else {
      toInsert.push(p);
    }
  }
  return { toInsert, duplicates };
}

export interface CommentForDiff {
  id: number;
  body: string | null;
  author_test_user_id: number;
  created_at: Date;
}

export function diffComments(
  prod: CommentForDiff[],
  test: CommentForDiff[],
): DiffResult<CommentForDiff> {
  const idx = new Map<string, number>();
  for (const t of test) idx.set(commentFp(t), t.id);
  const toInsert: CommentForDiff[] = [];
  const duplicates: DiffResult<CommentForDiff>["duplicates"] = [];
  for (const p of prod) {
    const fp = commentFp(p);
    const hit = idx.get(fp);
    if (hit !== undefined) {
      duplicates.push({ prodId: p.id, testId: hit, matchedBy: "commentFp" });
    } else {
      toInsert.push(p);
    }
  }
  return { toInsert, duplicates };
}
```

- [ ] **Step 2: Run, expect pass**

Run: `pnpm test tests/unit/reconcile/diff.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/imports/reconcile/diff.ts tests/unit/reconcile/diff.test.ts
git commit -m "feat(reconcile): content fingerprint diff"
```

---

### Task 9: Mappers — failing test

**Files:**
- Create: `tests/unit/reconcile/mappers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/reconcile/mappers.test.ts
import { describe, it, expect, vi } from "vitest";
import { createMappers } from "@/lib/imports/reconcile/mappers";

function fakePool(rows: Record<string, any[]>) {
  const calls: { sql: string; params: any[] }[] = [];
  return {
    calls,
    query: vi.fn(async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      if (sql.includes("bc2_projects_map")) {
        const key = params[0];
        return { rows: rows[`projects:${key}`] ?? [] };
      }
      if (sql.includes("bc2_people_map")) {
        const key = params[0];
        return { rows: rows[`people:${key}`] ?? [] };
      }
      if (sql.includes("FROM clients")) {
        const key = params[0];
        return { rows: rows[`clients:${key}`] ?? [] };
      }
      return { rows: [] };
    }),
  } as any;
}

describe("mappers", () => {
  it("prodProjectIdToBc2Id returns null when missing", async () => {
    const pool = fakePool({});
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.prodProjectIdToBc2Id(42)).toBeNull();
  });

  it("caches prod project lookup", async () => {
    const pool = fakePool({ "projects:42": [{ bc2_id: 100 }] });
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.prodProjectIdToBc2Id(42)).toBe(100);
    expect(await m.prodProjectIdToBc2Id(42)).toBe(100);
    expect(pool.calls.length).toBe(1);
  });

  it("bc2IdToTestProjectId hits test side", async () => {
    const pool = fakePool({ "projects:100": [{ project_id: 7 }] });
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.bc2IdToTestProjectId(100)).toBe(7);
  });

  it("prodUserIdToTestUserId returns null when prod side missing", async () => {
    const pool = fakePool({});
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.prodUserIdToTestUserId(99)).toBeNull();
  });

  it("prodUserIdToTestUserId returns null when test side missing", async () => {
    const pool = fakePool({ "people:99": [{ bc2_id: 555 }] });
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.prodUserIdToTestUserId(99)).toBeNull();
  });

  it("prodUserIdToTestUserId resolves end-to-end", async () => {
    const pool = fakePool({
      "people:99": [{ bc2_id: 555 }],
      "people:555": [{ user_id: 8 }],
    });
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.prodUserIdToTestUserId(99)).toBe(8);
  });

  it("testClientIdByCode returns null when code unknown", async () => {
    const pool = fakePool({});
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.testClientIdByCode("ACME")).toBeNull();
  });

  it("testClientIdByCode caches lookups", async () => {
    const pool = fakePool({ "clients:ACME": [{ id: 3 }] });
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.testClientIdByCode("ACME")).toBe(3);
    expect(await m.testClientIdByCode("ACME")).toBe(3);
    expect(pool.calls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm test tests/unit/reconcile/mappers.test.ts`
Expected: FAIL ("Cannot find module").

---

### Task 10: Mappers — implementation

**Files:**
- Create: `lib/imports/reconcile/mappers.ts`

- [ ] **Step 1: Write implementation**

```ts
// lib/imports/reconcile/mappers.ts
import type { Pool } from "pg";

export interface Mappers {
  prodProjectIdToBc2Id(prodProjectId: number): Promise<number | null>;
  bc2IdToTestProjectId(bc2Id: number): Promise<number | null>;
  prodUserIdToTestUserId(prodUserId: number): Promise<number | null>;
  testClientIdByCode(code: string): Promise<number | null>;
}

export function createMappers(opts: { prodPool: Pool; testPool: Pool }): Mappers {
  const { prodPool, testPool } = opts;

  const projProdToBc2 = new Map<number, number | null>();
  const projBc2ToTest = new Map<number, number | null>();
  const userProdToBc2 = new Map<number, number | null>();
  const userBc2ToTest = new Map<number, number | null>();
  const clientCodeToTest = new Map<string, number | null>();

  async function prodProjectIdToBc2Id(id: number): Promise<number | null> {
    if (projProdToBc2.has(id)) return projProdToBc2.get(id)!;
    const r = await prodPool.query(
      "SELECT bc2_id FROM bc2_projects_map WHERE project_id = $1 LIMIT 1",
      [id],
    );
    const v = r.rows[0]?.bc2_id ?? null;
    projProdToBc2.set(id, v);
    return v;
  }

  async function bc2IdToTestProjectId(bc2Id: number): Promise<number | null> {
    if (projBc2ToTest.has(bc2Id)) return projBc2ToTest.get(bc2Id)!;
    const r = await testPool.query(
      "SELECT project_id FROM bc2_projects_map WHERE bc2_id = $1 LIMIT 1",
      [bc2Id],
    );
    const v = r.rows[0]?.project_id ?? null;
    projBc2ToTest.set(bc2Id, v);
    return v;
  }

  async function prodUserIdToBc2Id(id: number): Promise<number | null> {
    if (userProdToBc2.has(id)) return userProdToBc2.get(id)!;
    const r = await prodPool.query(
      "SELECT bc2_id FROM bc2_people_map WHERE user_id = $1 LIMIT 1",
      [id],
    );
    const v = r.rows[0]?.bc2_id ?? null;
    userProdToBc2.set(id, v);
    return v;
  }

  async function bc2UserIdToTestUserId(bc2Id: number): Promise<number | null> {
    if (userBc2ToTest.has(bc2Id)) return userBc2ToTest.get(bc2Id)!;
    const r = await testPool.query(
      "SELECT user_id FROM bc2_people_map WHERE bc2_id = $1 LIMIT 1",
      [bc2Id],
    );
    const v = r.rows[0]?.user_id ?? null;
    userBc2ToTest.set(bc2Id, v);
    return v;
  }

  async function prodUserIdToTestUserId(id: number): Promise<number | null> {
    const bc2 = await prodUserIdToBc2Id(id);
    if (bc2 === null) return null;
    return bc2UserIdToTestUserId(bc2);
  }

  async function testClientIdByCode(code: string): Promise<number | null> {
    if (clientCodeToTest.has(code)) return clientCodeToTest.get(code)!;
    const r = await testPool.query(
      "SELECT id FROM clients WHERE code = $1 LIMIT 1",
      [code],
    );
    const v = r.rows[0]?.id ?? null;
    clientCodeToTest.set(code, v);
    return v;
  }

  return {
    prodProjectIdToBc2Id,
    bc2IdToTestProjectId,
    prodUserIdToTestUserId,
    testClientIdByCode,
  };
}
```

- [ ] **Step 2: Run, expect pass**

Run: `pnpm test tests/unit/reconcile/mappers.test.ts`
Expected: PASS.

> **Column-name caveat:** if Task 0's schema diff showed the join columns are named differently in your DBs (e.g. `bc2_projects_map.local_project_id` instead of `project_id`), update the SQL strings above before running tests.

- [ ] **Step 3: Commit**

```bash
git add lib/imports/reconcile/mappers.ts tests/unit/reconcile/mappers.test.ts
git commit -m "feat(reconcile): identity mappers (projects, people, clients)"
```

---

### Task 11: ProdReader

**Files:**
- Create: `lib/imports/reconcile/prod-reader.ts`

- [ ] **Step 1: Write implementation**

```ts
// lib/imports/reconcile/prod-reader.ts
import type { Pool } from "pg";
import type { ProdProject, FileRow, DiscussionRow, CommentRow } from "./types";

export interface ProdReader {
  activeProjects(opts: { projectBc2Id?: number; limit?: number | null }): Promise<ProdProject[]>;
  filesForProject(projectId: number): Promise<FileRow[]>;
  discussionsForProject(projectId: number): Promise<DiscussionRow[]>;
  commentsForThread(threadId: number): Promise<CommentRow[]>;
}

export function createProdReader(prodPool: Pool): ProdReader {
  async function activeProjects(opts: {
    projectBc2Id?: number;
    limit?: number | null;
  }): Promise<ProdProject[]> {
    const params: any[] = [];
    let where = "p.archived = false";
    if (opts.projectBc2Id !== undefined) {
      params.push(opts.projectBc2Id);
      where += ` AND m.bc2_id = $${params.length}`;
    }
    let sql = `
      SELECT p.id, m.bc2_id, p.title, p.client_id, c.code AS client_code,
             p.slug, p.description, p.archived, p.created_at, p.updated_at
        FROM projects p
        JOIN bc2_projects_map m ON m.project_id = p.id
        JOIN clients c ON c.id = p.client_id
       WHERE ${where}
       ORDER BY p.id`;
    if (opts.limit != null) {
      params.push(opts.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const r = await prodPool.query(sql, params);
    return r.rows.map(rowToProdProject);
  }

  async function filesForProject(projectId: number): Promise<FileRow[]> {
    const r = await prodPool.query(
      `SELECT id, project_id, uploader_id, filename, size, mime_type, dropbox_path, created_at
         FROM project_files
        WHERE project_id = $1
        ORDER BY id`,
      [projectId],
    );
    return r.rows.map((row) => ({ ...row, created_at: new Date(row.created_at) }));
  }

  async function discussionsForProject(projectId: number): Promise<DiscussionRow[]> {
    const r = await prodPool.query(
      `SELECT id, project_id, author_id, title, body, created_at
         FROM threads
        WHERE project_id = $1
        ORDER BY id`,
      [projectId],
    );
    return r.rows.map((row) => ({ ...row, created_at: new Date(row.created_at) }));
  }

  async function commentsForThread(threadId: number): Promise<CommentRow[]> {
    const r = await prodPool.query(
      `SELECT id, thread_id, author_id, body, created_at
         FROM comments
        WHERE thread_id = $1
        ORDER BY id`,
      [threadId],
    );
    return r.rows.map((row) => ({ ...row, created_at: new Date(row.created_at) }));
  }

  return { activeProjects, filesForProject, discussionsForProject, commentsForThread };
}

function rowToProdProject(row: any): ProdProject {
  return {
    ...row,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}
```

> Update column names per Task 0 if needed.

- [ ] **Step 2: Commit**

```bash
git add lib/imports/reconcile/prod-reader.ts
git commit -m "feat(reconcile): read-only prod reader"
```

---

### Task 12: TestWriter

**Files:**
- Create: `lib/imports/reconcile/test-writer.ts`

- [ ] **Step 1: Write implementation**

```ts
// lib/imports/reconcile/test-writer.ts
import type { Pool, PoolClient } from "pg";
import type {
  ProdProject,
  FileRow,
  DiscussionRow,
  CommentRow,
} from "./types";

export interface TestWriter {
  withProjectTx<R>(fn: (client: PoolClient) => Promise<R>): Promise<R>;
  filesForProject(client: PoolClient, projectId: number): Promise<FileRow[]>;
  discussionsForProject(client: PoolClient, projectId: number): Promise<DiscussionRow[]>;
  commentsForThread(client: PoolClient, threadId: number): Promise<CommentRow[]>;
  createProject(client: PoolClient, prod: ProdProject, mappedClientId: number): Promise<number>;
  insertProjectMapRow(client: PoolClient, projectId: number, bc2Id: number): Promise<void>;
  insertFile(
    client: PoolClient,
    projectId: number,
    file: FileRow,
    uploaderTestUserId: number,
  ): Promise<number>;
  insertDiscussion(
    client: PoolClient,
    projectId: number,
    discussion: DiscussionRow,
    authorTestUserId: number,
  ): Promise<number>;
  insertComment(
    client: PoolClient,
    threadId: number,
    comment: CommentRow,
    authorTestUserId: number,
  ): Promise<number>;
}

export function createTestWriter(testPool: Pool): TestWriter {
  async function withProjectTx<R>(fn: (c: PoolClient) => Promise<R>): Promise<R> {
    const client = await testPool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async function filesForProject(c: PoolClient, projectId: number): Promise<FileRow[]> {
    const r = await c.query(
      `SELECT id, project_id, uploader_id, filename, size, mime_type, dropbox_path, created_at
         FROM project_files WHERE project_id = $1`,
      [projectId],
    );
    return r.rows.map((row) => ({ ...row, created_at: new Date(row.created_at) }));
  }

  async function discussionsForProject(c: PoolClient, projectId: number): Promise<DiscussionRow[]> {
    const r = await c.query(
      `SELECT id, project_id, author_id, title, body, created_at
         FROM threads WHERE project_id = $1`,
      [projectId],
    );
    return r.rows.map((row) => ({ ...row, created_at: new Date(row.created_at) }));
  }

  async function commentsForThread(c: PoolClient, threadId: number): Promise<CommentRow[]> {
    const r = await c.query(
      `SELECT id, thread_id, author_id, body, created_at
         FROM comments WHERE thread_id = $1`,
      [threadId],
    );
    return r.rows.map((row) => ({ ...row, created_at: new Date(row.created_at) }));
  }

  async function createProject(
    c: PoolClient,
    prod: ProdProject,
    mappedClientId: number,
  ): Promise<number> {
    const r = await c.query(
      `INSERT INTO projects (title, client_id, slug, description, archived, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [prod.title, mappedClientId, prod.slug, prod.description, false, prod.created_at, prod.updated_at],
    );
    return r.rows[0].id;
  }

  async function insertProjectMapRow(c: PoolClient, projectId: number, bc2Id: number): Promise<void> {
    await c.query(
      `INSERT INTO bc2_projects_map (project_id, bc2_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [projectId, bc2Id],
    );
  }

  async function insertFile(
    c: PoolClient,
    projectId: number,
    f: FileRow,
    uploaderTestUserId: number,
  ): Promise<number> {
    const r = await c.query(
      `INSERT INTO project_files (project_id, uploader_id, filename, size, mime_type, dropbox_path, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [projectId, uploaderTestUserId, f.filename, f.size, f.mime_type, f.dropbox_path, f.created_at],
    );
    return r.rows[0].id;
  }

  async function insertDiscussion(
    c: PoolClient,
    projectId: number,
    d: DiscussionRow,
    authorTestUserId: number,
  ): Promise<number> {
    const r = await c.query(
      `INSERT INTO threads (project_id, author_id, title, body, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [projectId, authorTestUserId, d.title, d.body, d.created_at],
    );
    return r.rows[0].id;
  }

  async function insertComment(
    c: PoolClient,
    threadId: number,
    cm: CommentRow,
    authorTestUserId: number,
  ): Promise<number> {
    const r = await c.query(
      `INSERT INTO comments (thread_id, author_id, body, created_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [threadId, authorTestUserId, cm.body, cm.created_at],
    );
    return r.rows[0].id;
  }

  return {
    withProjectTx,
    filesForProject,
    discussionsForProject,
    commentsForThread,
    createProject,
    insertProjectMapRow,
    insertFile,
    insertDiscussion,
    insertComment,
  };
}
```

> Update column names per Task 0 if needed. If `projects` requires more NOT-NULL columns than this insert provides (e.g. `status`, `code`, etc.), add them — copying from prod's row — before running.

- [ ] **Step 2: Commit**

```bash
git add lib/imports/reconcile/test-writer.ts
git commit -m "feat(reconcile): test-side writer with per-project transactions"
```

---

### Task 13: Reconcile job logger

**Files:**
- Create: `lib/imports/reconcile/reconcile-job.ts`

- [ ] **Step 1: Write implementation**

```ts
// lib/imports/reconcile/reconcile-job.ts
import type { Pool } from "pg";
import type { ReconcileSummary } from "./types";

export type Phase = "project" | "file" | "discussion" | "comment";
export type Action = "inserted" | "duplicate" | "orphan" | "skipped" | "error";

export interface JobLogger {
  jobId: string;
  log(entry: {
    projectBc2Id: number | null;
    phase: Phase;
    action: Action;
    prodId?: number | null;
    testId?: number | null;
    reason?: string | null;
  }): Promise<void>;
  finish(status: "completed" | "failed" | "interrupted", summary: ReconcileSummary): Promise<void>;
}

export async function startJob(
  pool: Pool,
  opts: { dryRun: boolean },
): Promise<JobLogger> {
  const r = await pool.query(
    `INSERT INTO reconcile_jobs (status, dry_run) VALUES ('running', $1) RETURNING id`,
    [opts.dryRun],
  );
  const jobId: string = r.rows[0].id;

  async function log(entry: {
    projectBc2Id: number | null;
    phase: Phase;
    action: Action;
    prodId?: number | null;
    testId?: number | null;
    reason?: string | null;
  }) {
    if (opts.dryRun) return;
    await pool.query(
      `INSERT INTO reconcile_logs (job_id, project_bc2_id, phase, action, prod_id, test_id, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        jobId,
        entry.projectBc2Id,
        entry.phase,
        entry.action,
        entry.prodId ?? null,
        entry.testId ?? null,
        entry.reason ?? null,
      ],
    );
  }

  async function finish(status: "completed" | "failed" | "interrupted", summary: ReconcileSummary) {
    await pool.query(
      `UPDATE reconcile_jobs SET status = $1, finished_at = now(), summary_json = $2 WHERE id = $3`,
      [status, summary, jobId],
    );
  }

  return { jobId, log, finish };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/imports/reconcile/reconcile-job.ts
git commit -m "feat(reconcile): job/log writer for reconcile_jobs and reconcile_logs"
```

---

### Task 14: CSV writer helper

**Files:**
- Create: `lib/imports/reconcile/csv-writer.ts`

- [ ] **Step 1: Write implementation**

```ts
// lib/imports/reconcile/csv-writer.ts
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

export interface CsvWriter {
  open(filename: string, header: string[]): Promise<void>;
  row(filename: string, values: (string | number | null)[]): Promise<void>;
  close(): Promise<void>;
}

export async function createCsvWriter(outDir: string): Promise<CsvWriter> {
  await fs.mkdir(outDir, { recursive: true });
  const handles = new Map<string, FileHandle>();

  function quote(v: string | number | null): string {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  return {
    async open(filename, header) {
      if (handles.has(filename)) return;
      const h = await fs.open(join(outDir, filename), "w");
      await h.write(header.map(quote).join(",") + "\n");
      handles.set(filename, h);
    },
    async row(filename, values) {
      const h = handles.get(filename);
      if (!h) throw new Error(`csv not open: ${filename}`);
      await h.write(values.map(quote).join(",") + "\n");
    },
    async close() {
      for (const h of handles.values()) await h.close();
      handles.clear();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/imports/reconcile/csv-writer.ts
git commit -m "feat(reconcile): CSV writer helper"
```

---

### Task 15: Main script — CLI parsing + backup gate

**Files:**
- Create: `scripts/reconcile-prod-active-to-test.ts`

- [ ] **Step 1: Write skeleton**

```ts
// scripts/reconcile-prod-active-to-test.ts
import "dotenv/config";
import { Pool } from "pg";
import { join } from "node:path";
import { createProdReader } from "@/lib/imports/reconcile/prod-reader";
import { createTestWriter } from "@/lib/imports/reconcile/test-writer";
import { createMappers } from "@/lib/imports/reconcile/mappers";
import { applyOrphanFilter } from "@/lib/imports/reconcile/orphan-filter";
import { diffFiles, diffDiscussions, diffComments } from "@/lib/imports/reconcile/diff";
import { startJob } from "@/lib/imports/reconcile/reconcile-job";
import { createCsvWriter } from "@/lib/imports/reconcile/csv-writer";
import type { CliFlags, ReconcileSummary } from "@/lib/imports/reconcile/types";

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    projectId: null,
    limit: null,
    dryRun: false,
    outDir: `tmp/reconcile/${new Date().toISOString().replace(/[:.]/g, "-")}`,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--project-id=")) flags.projectId = Number(arg.slice("--project-id=".length));
    else if (arg.startsWith("--limit=")) flags.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg.startsWith("--out-dir=")) flags.outDir = arg.slice("--out-dir=".length);
    else throw new Error(`unknown flag: ${arg}`);
  }
  return flags;
}

async function ensureBackupGate(testPool: Pool, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  if (process.env.RECONCILE_CONFIRM !== "yes") {
    const r = await testPool.query("SELECT current_database() AS db, pg_database_size(current_database()) AS bytes");
    const { db, bytes } = r.rows[0];
    console.error(`Refusing to write to ${db} (${Number(bytes).toLocaleString()} bytes). Set RECONCILE_CONFIRM=yes after confirming a verified test-DB backup.`);
    process.exit(2);
  }
}

async function main() {
  const flags = parseFlags(process.argv);
  if (!process.env.PROD_DATABASE_URL) throw new Error("PROD_DATABASE_URL is required");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const prodPool = new Pool({ connectionString: process.env.PROD_DATABASE_URL });
  const testPool = new Pool({ connectionString: process.env.DATABASE_URL });
  await ensureBackupGate(testPool, flags.dryRun);

  await prodPool.query("SET default_transaction_read_only = on");

  const prodReader = createProdReader(prodPool);
  const testWriter = createTestWriter(testPool);
  const mappers = createMappers({ prodPool, testPool });
  const job = await startJob(testPool, { dryRun: flags.dryRun });

  const csv = await createCsvWriter(flags.outDir);
  await csv.open("unmapped-active.csv", ["prod_project_id", "title", "client_code", "prod_created_at"]);
  await csv.open("unresolved-client.csv", ["prod_project_id", "title", "prod_client_code"]);
  await csv.open("unmapped-people.csv", ["prod_user_id", "encountered_in", "prod_item_id"]);
  await csv.open("orphans-dropped.csv", ["project_bc2_id", "project_title", "item_type", "item_id", "item_created_at", "project_created_at", "delta_seconds"]);
  await csv.open("inserted.csv", ["project_bc2_id", "item_type", "prod_id", "test_id", "fingerprint"]);
  await csv.open("skipped-duplicate.csv", ["project_bc2_id", "item_type", "prod_id", "matched_test_id", "matched_by"]);

  const t0 = Date.now();
  const summary: ReconcileSummary = {
    startedAt: new Date(t0).toISOString(),
    finishedAt: null,
    dryRun: flags.dryRun,
    prodActiveTotal: 0,
    unmappedProjects: 0,
    unresolvedClient: 0,
    syncedProjects: 0,
    newTestProjects: 0,
    files:       { inserted: 0, duplicate: 0, orphan: 0 },
    discussions: { inserted: 0, duplicate: 0, orphan: 0 },
    comments:    { inserted: 0, duplicate: 0, orphan: 0 },
    peopleSkips: 0,
    walltimeMs: 0,
  };

  let exitCode = 0;
  let interrupted = false;
  process.on("SIGINT", () => { interrupted = true; });

  try {
    const projects = await prodReader.activeProjects({
      projectBc2Id: flags.projectId ?? undefined,
      limit: flags.limit,
    });
    summary.prodActiveTotal = projects.length;
    console.log(`Prod active projects to consider: ${projects.length}`);

    for (const proj of projects) {
      if (interrupted) break;
      try {
        await processProject({
          proj, prodReader, testWriter, mappers, job, csv, summary, dryRun: flags.dryRun,
        });
      } catch (e) {
        exitCode = 1;
        console.error(`Project ${proj.bc2_id} (${proj.title}) failed:`, e);
        await job.log({ projectBc2Id: proj.bc2_id, phase: "project", action: "error", reason: (e as Error).message });
      }
    }
  } finally {
    summary.finishedAt = new Date().toISOString();
    summary.walltimeMs = Date.now() - t0;
    await job.finish(interrupted ? "interrupted" : exitCode === 0 ? "completed" : "failed", summary);
    await csv.close();
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(flags.outDir, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    await prodPool.end();
    await testPool.end();
    if (interrupted) process.exit(130);
    process.exit(exitCode);
  }
}

// processProject defined in next task

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Commit (script not yet runnable; processProject in next task)**

```bash
git add scripts/reconcile-prod-active-to-test.ts
git commit -m "feat(reconcile): script skeleton with CLI, backup gate, csv setup"
```

---

### Task 16: Per-project orchestration — `processProject`

**Files:**
- Modify: `scripts/reconcile-prod-active-to-test.ts` (append `processProject` and helpers)

- [ ] **Step 1: Append `processProject` to the script**

Insert immediately above the `// processProject defined in next task` line. Move the existing `import` statements at the top so the new ones below are added to the import block (TypeScript requires imports at top). The block to add:

Top-of-file imports (add):
```ts
import type { ProdProject } from "@/lib/imports/reconcile/types";
import type { ProdReader } from "@/lib/imports/reconcile/prod-reader";
import type { TestWriter } from "@/lib/imports/reconcile/test-writer";
import type { Mappers } from "@/lib/imports/reconcile/mappers";
import type { JobLogger } from "@/lib/imports/reconcile/reconcile-job";
import type { CsvWriter } from "@/lib/imports/reconcile/csv-writer";
import { fileFpA, discussionFp, commentFp } from "@/lib/imports/reconcile/fingerprints";
```

Body of new functions (append above the comment marker):
```ts
async function processProject(args: {
  proj: ProdProject;
  prodReader: ProdReader;
  testWriter: TestWriter;
  mappers: Mappers;
  job: JobLogger;
  csv: CsvWriter;
  summary: ReconcileSummary;
  dryRun: boolean;
}) {
  const { proj, prodReader, testWriter, mappers, job, csv, summary, dryRun } = args;

  if (proj.bc2_id == null) {
    summary.unmappedProjects++;
    await csv.row("unmapped-active.csv", [proj.id, proj.title, proj.client_code, proj.created_at.toISOString()]);
    await job.log({ projectBc2Id: null, phase: "project", action: "skipped", reason: "no_bc2_id" });
    return;
  }

  let testProjectId = await mappers.bc2IdToTestProjectId(proj.bc2_id);
  if (testProjectId == null) {
    const mappedClientId = await mappers.testClientIdByCode(proj.client_code);
    if (mappedClientId == null) {
      summary.unresolvedClient++;
      await csv.row("unresolved-client.csv", [proj.id, proj.title, proj.client_code]);
      await job.log({ projectBc2Id: proj.bc2_id, phase: "project", action: "skipped", reason: "unresolved_client_code" });
      return;
    }
    if (dryRun) {
      summary.newTestProjects++;
      await job.log({ projectBc2Id: proj.bc2_id, phase: "project", action: "inserted", prodId: proj.id, reason: "dry_run" });
    } else {
      await testWriter.withProjectTx(async (c) => {
        const newId = await testWriter.createProject(c, proj, mappedClientId);
        await testWriter.insertProjectMapRow(c, newId, proj.bc2_id);
        testProjectId = newId;
      });
      summary.newTestProjects++;
      await job.log({ projectBc2Id: proj.bc2_id, phase: "project", action: "inserted", prodId: proj.id, testId: testProjectId });
    }
  }

  if (testProjectId == null) return;

  const prodFiles = await prodReader.filesForProject(proj.id);
  const prodDiscussions = await prodReader.discussionsForProject(proj.id);

  const f = applyOrphanFilter(prodFiles, proj);
  const d = applyOrphanFilter(prodDiscussions, proj);
  await recordOrphans(csv, job, proj, "file", f.dropped);
  await recordOrphans(csv, job, proj, "discussion", d.dropped);
  summary.files.orphan += f.dropped.length;
  summary.discussions.orphan += d.dropped.length;

  await testWriter.withProjectTx(async (c) => {
    // Files.
    const testFiles = await testWriter.filesForProject(c, testProjectId!);
    const fileDiff = diffFiles(f.kept, testFiles);
    for (const dup of fileDiff.duplicates) {
      summary.files.duplicate++;
      await csv.row("skipped-duplicate.csv", [proj.bc2_id, "file", dup.prodId, dup.testId, dup.matchedBy]);
      await job.log({ projectBc2Id: proj.bc2_id, phase: "file", action: "duplicate", prodId: dup.prodId, testId: dup.testId, reason: dup.matchedBy });
    }
    for (const pf of fileDiff.toInsert) {
      const uploaderTestId = await mappers.prodUserIdToTestUserId(pf.uploader_id);
      if (uploaderTestId == null) {
        summary.peopleSkips++;
        await csv.row("unmapped-people.csv", [pf.uploader_id, "file", pf.id]);
        await job.log({ projectBc2Id: proj.bc2_id, phase: "file", action: "skipped", prodId: pf.id, reason: "unmapped_author" });
        continue;
      }
      let newId = -1;
      if (!dryRun) newId = await testWriter.insertFile(c, testProjectId!, pf, uploaderTestId);
      summary.files.inserted++;
      await csv.row("inserted.csv", [proj.bc2_id, "file", pf.id, newId, fileFpA(pf)]);
      await job.log({ projectBc2Id: proj.bc2_id, phase: "file", action: "inserted", prodId: pf.id, testId: newId });
    }

    // Discussions.
    const testDiscussions = await testWriter.discussionsForProject(c, testProjectId!);
    const discDiff = diffDiscussions(d.kept, testDiscussions);
    const prodIdToTestThreadId = new Map<number, number>();
    for (const dup of discDiff.duplicates) {
      summary.discussions.duplicate++;
      prodIdToTestThreadId.set(dup.prodId, dup.testId);
      await csv.row("skipped-duplicate.csv", [proj.bc2_id, "discussion", dup.prodId, dup.testId, dup.matchedBy]);
      await job.log({ projectBc2Id: proj.bc2_id, phase: "discussion", action: "duplicate", prodId: dup.prodId, testId: dup.testId, reason: dup.matchedBy });
    }
    for (const pd of discDiff.toInsert) {
      const authorTestId = await mappers.prodUserIdToTestUserId(pd.author_id);
      if (authorTestId == null) {
        summary.peopleSkips++;
        await csv.row("unmapped-people.csv", [pd.author_id, "discussion", pd.id]);
        await job.log({ projectBc2Id: proj.bc2_id, phase: "discussion", action: "skipped", prodId: pd.id, reason: "unmapped_author" });
        continue;
      }
      let newId = -1;
      if (!dryRun) newId = await testWriter.insertDiscussion(c, testProjectId!, pd, authorTestId);
      summary.discussions.inserted++;
      prodIdToTestThreadId.set(pd.id, newId);
      await csv.row("inserted.csv", [proj.bc2_id, "discussion", pd.id, newId, discussionFp(pd)]);
      await job.log({ projectBc2Id: proj.bc2_id, phase: "discussion", action: "inserted", prodId: pd.id, testId: newId });
    }

    // Comments.
    for (const [prodDiscId, testThreadId] of prodIdToTestThreadId) {
      const prodComments = await prodReader.commentsForThread(prodDiscId);
      const c2 = applyOrphanFilter(prodComments, proj);
      summary.comments.orphan += c2.dropped.length;
      await recordOrphans(csv, job, proj, "comment", c2.dropped);

      const prodMapped = await Promise.all(
        c2.kept.map(async (cm) => ({
          ...cm,
          author_test_user_id: await mappers.prodUserIdToTestUserId(cm.author_id),
        })),
      );
      const prodForDiff = prodMapped
        .filter((cm) => cm.author_test_user_id !== null)
        .map((cm) => ({
          id: cm.id,
          body: cm.body,
          author_test_user_id: cm.author_test_user_id as number,
          created_at: cm.created_at,
        }));

      for (const cm of prodMapped) {
        if (cm.author_test_user_id == null) {
          summary.peopleSkips++;
          await csv.row("unmapped-people.csv", [cm.author_id, "comment", cm.id]);
          await job.log({ projectBc2Id: proj.bc2_id, phase: "comment", action: "skipped", prodId: cm.id, reason: "unmapped_author" });
        }
      }

      const testComments = (testThreadId > 0
        ? await testWriter.commentsForThread(c, testThreadId)
        : []).map((cm) => ({
          id: cm.id,
          body: cm.body,
          author_test_user_id: cm.author_id,
          created_at: cm.created_at,
        }));

      const cmDiff = diffComments(prodForDiff, testComments);
      for (const dup of cmDiff.duplicates) {
        summary.comments.duplicate++;
        await csv.row("skipped-duplicate.csv", [proj.bc2_id, "comment", dup.prodId, dup.testId, dup.matchedBy]);
        await job.log({ projectBc2Id: proj.bc2_id, phase: "comment", action: "duplicate", prodId: dup.prodId, testId: dup.testId, reason: dup.matchedBy });
      }
      for (const pc of cmDiff.toInsert) {
        const original = c2.kept.find((x) => x.id === pc.id)!;
        let newId = -1;
        if (!dryRun && testThreadId > 0) {
          newId = await testWriter.insertComment(c, testThreadId, original, pc.author_test_user_id);
        }
        summary.comments.inserted++;
        await csv.row("inserted.csv", [proj.bc2_id, "comment", pc.id, newId, commentFp(pc)]);
        await job.log({ projectBc2Id: proj.bc2_id, phase: "comment", action: "inserted", prodId: pc.id, testId: newId });
      }
    }
  });

  summary.syncedProjects++;
}

async function recordOrphans(
  csv: CsvWriter,
  job: JobLogger,
  proj: ProdProject,
  itemType: "file" | "discussion" | "comment",
  dropped: { id: number; created_at: Date }[],
) {
  for (const item of dropped) {
    const deltaSec = Math.floor((proj.created_at.getTime() - item.created_at.getTime()) / 1000);
    await csv.row("orphans-dropped.csv", [
      proj.bc2_id, proj.title, itemType, item.id,
      item.created_at.toISOString(), proj.created_at.toISOString(), deltaSec,
    ]);
    await job.log({ projectBc2Id: proj.bc2_id, phase: itemType, action: "orphan", prodId: item.id });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors. If column-name drift errors appear, fix per Task 0 notes.

- [ ] **Step 3: Commit**

```bash
git add scripts/reconcile-prod-active-to-test.ts
git commit -m "feat(reconcile): per-project orchestration with phase diffs and CSV emit"
```

---

### Task 17: Integration test — happy path + idempotency

**Files:**
- Create: `tests/integration/reconcile-prod-active-to-test.test.ts`

> **Subprocess invocation note:** the test spawns the reconcile script. We use `execFileSync` (not `execSync`) with an arg array so each argument is passed verbatim and there is no shell interpolation.

- [ ] **Step 1: Write the test**

```ts
// tests/integration/reconcile-prod-active-to-test.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROD_SCHEMA = "reconcile_prod";
const TEST_SCHEMA = "reconcile_test";
const URL = process.env.TEST_DATABASE_URL;

if (!URL) {
  describe.skip("reconcile (no TEST_DATABASE_URL)", () => it.skip("skipped", () => {}));
} else {
  const pool = new Pool({ connectionString: URL });

  function envFor(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PROD_DATABASE_URL: `${URL}?options=-csearch_path=${PROD_SCHEMA}`,
      DATABASE_URL: `${URL}?options=-csearch_path=${TEST_SCHEMA}`,
      RECONCILE_CONFIRM: "yes",
    };
  }

  function runReconcile(args: string[]): void {
    execFileSync("pnpm", ["tsx", "scripts/reconcile-prod-active-to-test.ts", ...args], {
      env: envFor(),
      stdio: "pipe",
    });
  }

  beforeAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${PROD_SCHEMA} CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${PROD_SCHEMA}`);
    await pool.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    for (const schema of [PROD_SCHEMA, TEST_SCHEMA]) {
      await pool.query(`SET search_path TO ${schema}`);
      await pool.query(`
        CREATE TABLE clients (id serial PRIMARY KEY, code text UNIQUE NOT NULL);
        CREATE TABLE users (id serial PRIMARY KEY, email text UNIQUE NOT NULL);
        CREATE TABLE projects (
          id serial PRIMARY KEY, title text, client_id int, slug text,
          description text, archived boolean DEFAULT false,
          created_at timestamptz, updated_at timestamptz
        );
        CREATE TABLE project_files (
          id serial PRIMARY KEY, project_id int, uploader_id int,
          filename text, size bigint, mime_type text, dropbox_path text,
          created_at timestamptz
        );
        CREATE TABLE threads (
          id serial PRIMARY KEY, project_id int, author_id int,
          title text, body text, created_at timestamptz
        );
        CREATE TABLE comments (
          id serial PRIMARY KEY, thread_id int, author_id int,
          body text, created_at timestamptz
        );
        CREATE TABLE bc2_projects_map (project_id int PRIMARY KEY, bc2_id bigint UNIQUE);
        CREATE TABLE bc2_people_map (user_id int PRIMARY KEY, bc2_id bigint UNIQUE);
      `);
    }

    await pool.query(`SET search_path TO ${TEST_SCHEMA}`);
    await pool.query(readFileSync(join(process.cwd(), "supabase/migrations/0030_reconcile_logs.sql"), "utf8"));

    for (const schema of [PROD_SCHEMA, TEST_SCHEMA]) {
      await pool.query(`INSERT INTO ${schema}.clients (code) VALUES ('ACME')`);
      await pool.query(`INSERT INTO ${schema}.users (email) VALUES ('u@x.test')`);
      await pool.query(`INSERT INTO ${schema}.bc2_people_map (user_id, bc2_id) VALUES (1, 5000)`);
    }

    const pCreated = "2026-01-01T00:00:00Z";
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.projects (id, title, client_id, slug, description, archived, created_at, updated_at)
                      VALUES (1, 'Acme Site', 1, 'acme-site', 'desc', false, $1, $1)`, [pCreated]);
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.bc2_projects_map (project_id, bc2_id) VALUES (1, 9001)`);
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.project_files (project_id, uploader_id, filename, size, mime_type, dropbox_path, created_at)
                      VALUES (1, 1, 'orphan.pdf', 10, 'application/pdf', '/orphan', '2025-12-01T00:00:00Z'),
                             (1, 1, 'kept.pdf', 20, 'application/pdf', '/kept', '2026-01-15T00:00:00Z'),
                             (1, 1, 'shared.pdf', 30, 'application/pdf', '/shared', '2026-02-01T00:00:00Z')`);
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.threads (id, project_id, author_id, title, body, created_at)
                      VALUES (1, 1, 1, 'Hello', 'world', '2026-02-01T00:00:00Z'),
                             (2, 1, 1, 'Shared', 'same', '2026-02-15T00:00:00Z')`);
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.comments (thread_id, author_id, body, created_at)
                      VALUES (2, 1, 'cmt', '2026-02-15T01:00:00Z')`);

    await pool.query(`INSERT INTO ${TEST_SCHEMA}.projects (id, title, client_id, slug, description, archived, created_at, updated_at)
                      VALUES (1, 'Acme Site', 1, 'acme-site', 'desc', false, $1, $1)`, [pCreated]);
    await pool.query(`INSERT INTO ${TEST_SCHEMA}.bc2_projects_map (project_id, bc2_id) VALUES (1, 9001)`);
    await pool.query(`INSERT INTO ${TEST_SCHEMA}.project_files (project_id, uploader_id, filename, size, mime_type, dropbox_path, created_at)
                      VALUES (1, 1, 'shared.pdf', 30, 'application/pdf', '/shared', '2026-02-01T00:00:00Z')`);
    await pool.query(`INSERT INTO ${TEST_SCHEMA}.threads (id, project_id, author_id, title, body, created_at)
                      VALUES (1, 1, 1, 'Shared', 'same', '2026-02-15T00:00:00Z')`);
  }, 60000);

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${PROD_SCHEMA} CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.end();
  });

  it("syncs prod-only content, drops orphans, and is idempotent", async () => {
    const out = mkdtempSync(join(tmpdir(), "reconcile-"));
    runReconcile([`--out-dir=${out}`]);

    const tFiles = await pool.query(`SELECT filename FROM ${TEST_SCHEMA}.project_files ORDER BY filename`);
    expect(tFiles.rows.map((r) => r.filename)).toEqual(["kept.pdf", "shared.pdf"]);

    const tThreads = await pool.query(`SELECT title FROM ${TEST_SCHEMA}.threads ORDER BY title`);
    expect(tThreads.rows.map((r) => r.title)).toEqual(["Hello", "Shared"]);
    const tComments = await pool.query(`SELECT body FROM ${TEST_SCHEMA}.comments`);
    expect(tComments.rows.map((r) => r.body)).toEqual(["cmt"]);

    const before = await pool.query(`SELECT (SELECT count(*) FROM ${TEST_SCHEMA}.project_files) AS f,
                                            (SELECT count(*) FROM ${TEST_SCHEMA}.threads) AS t,
                                            (SELECT count(*) FROM ${TEST_SCHEMA}.comments) AS c`);
    runReconcile([`--out-dir=${out}`]);
    const after = await pool.query(`SELECT (SELECT count(*) FROM ${TEST_SCHEMA}.project_files) AS f,
                                           (SELECT count(*) FROM ${TEST_SCHEMA}.threads) AS t,
                                           (SELECT count(*) FROM ${TEST_SCHEMA}.comments) AS c`);
    expect(after.rows[0]).toEqual(before.rows[0]);

    rmSync(out, { recursive: true, force: true });
  }, 120000);
}
```

- [ ] **Step 2: Run the test**

Run: `pnpm test tests/integration/reconcile-prod-active-to-test.test.ts`
Expected: PASS (or skip if `TEST_DATABASE_URL` is unset). To run locally, set `TEST_DATABASE_URL` to a Postgres instance you can write to.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/reconcile-prod-active-to-test.test.ts
git commit -m "test(reconcile): integration test for happy path + idempotency"
```

---

### Task 18: Integration test — edge cases

**Files:**
- Modify: `tests/integration/reconcile-prod-active-to-test.test.ts` (append additional `it` blocks inside the existing `else`)

- [ ] **Step 1: Append edge-case tests**

```ts
  it("flags unmapped prod-active project to CSV and skips it", async () => {
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.projects (title, client_id, slug, archived, created_at, updated_at)
                      VALUES ('Unmapped', 1, 'unmapped', false, '2026-03-01', '2026-03-01')`);
    const out = mkdtempSync(join(tmpdir(), "reconcile-"));
    runReconcile([`--out-dir=${out}`]);
    const csv = readFileSync(join(out, "unmapped-active.csv"), "utf8");
    expect(csv).toMatch(/Unmapped/);
    rmSync(out, { recursive: true, force: true });
  }, 120000);

  it("creates a new test project when prod-active project has no test row", async () => {
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.projects (id, title, client_id, slug, archived, created_at, updated_at)
                      VALUES (50, 'Brand New', 1, 'brand-new', false, '2026-04-01', '2026-04-01')`);
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.bc2_projects_map (project_id, bc2_id) VALUES (50, 9050)`);
    const out = mkdtempSync(join(tmpdir(), "reconcile-"));
    runReconcile([`--project-id=9050`, `--out-dir=${out}`]);
    const r = await pool.query(`SELECT title FROM ${TEST_SCHEMA}.projects WHERE title = 'Brand New'`);
    expect(r.rowCount).toBe(1);
    rmSync(out, { recursive: true, force: true });
  }, 120000);

  it("skips item with unmapped author and records to CSV", async () => {
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.users (email) VALUES ('orphan@x.test')`);
    const u = await pool.query(`SELECT id FROM ${PROD_SCHEMA}.users WHERE email = 'orphan@x.test'`);
    const orphanUserId = u.rows[0].id;
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.threads (project_id, author_id, title, body, created_at)
                      VALUES (1, $1, 'NoAuthorMap', 'x', '2026-03-15')`, [orphanUserId]);
    const out = mkdtempSync(join(tmpdir(), "reconcile-"));
    runReconcile([`--project-id=9001`, `--out-dir=${out}`]);
    const csv = readFileSync(join(out, "unmapped-people.csv"), "utf8");
    expect(csv).toMatch(/discussion/);
    rmSync(out, { recursive: true, force: true });
  }, 120000);

  it("dry-run leaves test DB unchanged but populates inserted.csv", async () => {
    await pool.query(`INSERT INTO ${PROD_SCHEMA}.project_files (project_id, uploader_id, filename, size, mime_type, dropbox_path, created_at)
                      VALUES (1, 1, 'dryrun.pdf', 99, 'application/pdf', '/dryrun', '2026-03-20')`);
    const before = await pool.query(`SELECT count(*)::int AS n FROM ${TEST_SCHEMA}.project_files`);
    const out = mkdtempSync(join(tmpdir(), "reconcile-"));
    runReconcile([`--dry-run`, `--project-id=9001`, `--out-dir=${out}`]);
    const after = await pool.query(`SELECT count(*)::int AS n FROM ${TEST_SCHEMA}.project_files`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const csv = readFileSync(join(out, "inserted.csv"), "utf8");
    expect(csv).toMatch(/file/);
    rmSync(out, { recursive: true, force: true });
  }, 120000);
```

- [ ] **Step 2: Run the suite**

Run: `pnpm test tests/integration/reconcile-prod-active-to-test.test.ts`
Expected: PASS, all `it` blocks green.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/reconcile-prod-active-to-test.test.ts
git commit -m "test(reconcile): edge cases (unmapped project, new test row, unmapped author, dry-run)"
```

---

### Task 19: package.json npm script entry

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add script**

Edit `package.json` `"scripts"` block, append:

```json
    "reconcile:prod-to-test": "npx tsx scripts/reconcile-prod-active-to-test.ts"
```

(Don't forget the comma on the prior line.)

- [ ] **Step 2: Verify**

Run: `pnpm reconcile:prod-to-test --dry-run --limit=1` against a small dev DB pair. Expect summary printed; `tmp/reconcile/<ts>/` populated.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(reconcile): add pnpm reconcile:prod-to-test script"
```

---

### Task 20: Manual smoke + final verification

**Files:**
- Read-only across both DBs

> **Backup gate:** before any non-dry-run, confirm a verified test-DB backup exists. Per persistent memory, this is required for any DB change.

- [ ] **Step 1: Single-project dry run**

```bash
RECONCILE_CONFIRM=yes pnpm tsx scripts/reconcile-prod-active-to-test.ts \
  --project-id=<known-good-bc2-id> --dry-run
```

Inspect `tmp/reconcile/*/inserted.csv` and `orphans-dropped.csv`. Confirm planned inserts look right and orphans match expectations.

- [ ] **Step 2: Single-project live run**

```bash
RECONCILE_CONFIRM=yes pnpm tsx scripts/reconcile-prod-active-to-test.ts \
  --project-id=<known-good-bc2-id>
```

Verify in test DB: file/discussion/comment counts increased by exactly the `inserted.csv` count.

- [ ] **Step 3: Re-run for idempotency**

Re-run the same command. Expect zero inserts, all duplicates / orphans unchanged.

- [ ] **Step 4: Limited batch**

```bash
RECONCILE_CONFIRM=yes pnpm tsx scripts/reconcile-prod-active-to-test.ts --limit=5
```

Spot-check.

- [ ] **Step 5: Full run**

```bash
RECONCILE_CONFIRM=yes pnpm tsx scripts/reconcile-prod-active-to-test.ts
```

Save output `summary.json` and CSVs to a permanent location for audit.

- [ ] **Step 6: Final commit (if anything tweaked during smoke)**

```bash
git add -A
git commit -m "chore(reconcile): notes from first full run"
```

---

## Self-review notes

- Spec coverage:
  - §Architecture → Tasks 2, 11, 12, 15
  - §Data flow → Task 16
  - §Fingerprints → Tasks 3-4
  - §Orphan filter → Tasks 5-6
  - §Map mediation → Tasks 9-10
  - §Outputs (CSVs + summary + tables) → Tasks 1, 13, 14, 16
  - §Error handling → Task 15 (gate, SIGINT, dry-run), Task 16 (per-project tx)
  - §Testing → Tasks 3, 5, 7, 9, 17, 18
- Placeholders: none. Code blocks complete.
- Type consistency: `FileRow`, `DiscussionRow`, `CommentRow`, `ProdProject` defined in Task 2 and used unchanged through 11, 12, 16. `applyOrphanFilter`, `diffFiles`, `diffDiscussions`, `diffComments` signatures are stable from definition to use.
- Schema-drift caveat (Task 0) is the single source for column names; later tasks reference it explicitly.
- Subprocess safety: integration tests use `execFileSync` with arg arrays — no shell, no injection surface.
