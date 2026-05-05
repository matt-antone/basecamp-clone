# Reconcile Active Filenames Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-time backfill CLI that strips the BC2-import double-prefix (`<13-digit-ts>-<bc-attachment-id>-`) from `project_files.dropbox_path` for active (non-archived) projects, renaming files in Dropbox and updating the DB row in lockstep.

**Architecture:** Two-step CLI (`plan` then `apply`) backed by a sidecar progress file with `{dropbox_done, db_done}` per row. Pure functions for prefix stripping and collision resolution; thin Dropbox adapter wrappers; mocked-adapter tests for plan/apply orchestration.

**Tech Stack:** TypeScript, `tsx`, `vitest`, `pg`, Dropbox SDK 10.x. Existing storage adapter at `lib/storage/dropbox-adapter.ts`.

**Spec:** `docs/superpowers/specs/2026-04-28-reconcile-active-filenames-design.md`

---

## File Structure

**New files:**
- `lib/reconcile-filenames/types.ts` — `PlanRow`, `OrphanRow`, `ErrorRow`, `ProgressRow`, `ProgressFile` types.
- `lib/reconcile-filenames/strip.ts` — `stripPrefix(name)`, `resolveCollision(target, taken)`.
- `lib/reconcile-filenames/plan.ts` — `buildPlan({ db, dropbox, limit })`.
- `lib/reconcile-filenames/apply.ts` — `applyPlan({ plan, progress, dropbox, db, concurrency, limit, flush })`.
- `scripts/reconcile-active-filenames.ts` — CLI entry (`plan` and `apply` subcommands).
- `tests/unit/reconcile-strip.test.ts`
- `tests/unit/reconcile-plan.test.ts`
- `tests/unit/reconcile-apply.test.ts`

**Modified files:**
- `lib/storage/dropbox-adapter.ts` — add public `listFolderEntries(path)` and `moveFile({ from, to, autorename? })` methods.

---

## Task 1: Strip + collision pure functions

**Files:**
- Create: `lib/reconcile-filenames/types.ts`
- Create: `lib/reconcile-filenames/strip.ts`
- Test: `tests/unit/reconcile-strip.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/reconcile-strip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveCollision, stripPrefix } from "@/lib/reconcile-filenames/strip";

describe("stripPrefix", () => {
  it("strips 13-digit timestamp + numeric id prefix", () => {
    expect(stripPrefix("1775067993312-521625632-EPGGB-2026-newsletter01-r2.pdf")).toBe(
      "EPGGB-2026-newsletter01-r2.pdf"
    );
  });

  it("returns null when only a 13-digit timestamp prefix is present", () => {
    expect(stripPrefix("1775067993312-foo.pdf")).toBeNull();
  });

  it("returns null for unprefixed names", () => {
    expect(stripPrefix("EPGGB-2026-newsletter01-r2.pdf")).toBeNull();
  });

  it("returns null when timestamp is not exactly 13 digits", () => {
    expect(stripPrefix("123-456-foo.pdf")).toBeNull();
    expect(stripPrefix("17750679933121-521625632-foo.pdf")).toBeNull();
  });

  it("returns null when second group is not numeric", () => {
    expect(stripPrefix("1775067993312-abc-foo.pdf")).toBeNull();
  });

  it("returns null when there is no remainder after the prefix", () => {
    expect(stripPrefix("1775067993312-521625632-")).toBeNull();
  });
});

describe("resolveCollision", () => {
  it("returns target unchanged when not taken", () => {
    const taken = new Set<string>();
    expect(resolveCollision("foo.pdf", taken)).toBe("foo.pdf");
    expect(taken.has("foo.pdf")).toBe(true);
  });

  it("appends -2 when target is taken", () => {
    const taken = new Set(["foo.pdf"]);
    expect(resolveCollision("foo.pdf", taken)).toBe("foo-2.pdf");
    expect(taken.has("foo-2.pdf")).toBe(true);
  });

  it("increments suffix until free", () => {
    const taken = new Set(["foo.pdf", "foo-2.pdf", "foo-3.pdf"]);
    expect(resolveCollision("foo.pdf", taken)).toBe("foo-4.pdf");
  });

  it("inserts suffix before the last dot for multi-dot extensions", () => {
    const taken = new Set(["foo.tar.gz"]);
    expect(resolveCollision("foo.tar.gz", taken)).toBe("foo.tar-2.gz");
  });

  it("appends bare -N to extensionless names", () => {
    const taken = new Set(["README"]);
    expect(resolveCollision("README", taken)).toBe("README-2");
  });

  it("is case-sensitive (matches Dropbox behaviour)", () => {
    const taken = new Set(["Foo.pdf"]);
    expect(resolveCollision("foo.pdf", taken)).toBe("foo.pdf");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/reconcile-strip.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/reconcile-filenames/strip"`.

- [ ] **Step 3: Write `lib/reconcile-filenames/types.ts`**

```ts
export type PlanRow = {
  fileId: string;
  projectId: string;
  dropboxFileId: string | null;
  fromPath: string;
  toPath: string;
};

export type OrphanRow = {
  projectId: string;
  path: string;
  basename: string;
};

export type ErrorRow = {
  projectId: string;
  error: string;
};

export type ProgressRow = {
  dropbox_done: boolean;
  db_done: boolean;
  newPath?: string;
  error?: string;
};

export type ProgressFile = Record<string, ProgressRow>;
```

- [ ] **Step 4: Write `lib/reconcile-filenames/strip.ts`**

```ts
const PREFIX_REGEX = /^(\d{13})-(\d+)-(.+)$/;

export function stripPrefix(basename: string): string | null {
  const match = basename.match(PREFIX_REGEX);
  if (!match) return null;
  const remainder = match[3];
  return remainder.length > 0 ? remainder : null;
}

export function resolveCollision(target: string, taken: Set<string>): string {
  if (!taken.has(target)) {
    taken.add(target);
    return target;
  }

  const lastDot = target.lastIndexOf(".");
  const stem = lastDot > 0 ? target.slice(0, lastDot) : target;
  const ext = lastDot > 0 ? target.slice(lastDot) : "";

  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }

  throw new Error(`resolveCollision: exhausted suffix attempts for ${target}`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/reconcile-strip.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Commit**

```bash
git add lib/reconcile-filenames/types.ts lib/reconcile-filenames/strip.ts tests/unit/reconcile-strip.test.ts
git commit -m "feat(reconcile): add stripPrefix + resolveCollision helpers"
```

---

## Task 2: Dropbox adapter — listFolderEntries + moveFile

**Files:**
- Modify: `lib/storage/dropbox-adapter.ts`
- Test: `tests/unit/dropbox-reconcile-ops.test.ts`

The reconcile flow needs two adapter capabilities not exposed today: paginated folder listing and a file-level move that accepts either a path or a Dropbox file id (via the `id:<file_id>` form).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/dropbox-reconcile-ops.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { DropboxStorageAdapter } from "@/lib/storage/dropbox-adapter";

type FakeClient = {
  filesListFolder: ReturnType<typeof vi.fn>;
  filesListFolderContinue: ReturnType<typeof vi.fn>;
  filesMoveV2: ReturnType<typeof vi.fn>;
};

function adapterWithClient(client: FakeClient) {
  const adapter = new DropboxStorageAdapter() as unknown as {
    listFolderEntries: DropboxStorageAdapter["listFolderEntries"];
    moveFile: DropboxStorageAdapter["moveFile"];
    getClient: () => Promise<FakeClient>;
  };
  adapter.getClient = async () => client;
  return adapter;
}

describe("DropboxStorageAdapter.listFolderEntries", () => {
  it("returns all file entries across pagination", async () => {
    const client: FakeClient = {
      filesListFolder: vi.fn().mockResolvedValue({
        result: {
          entries: [
            { ".tag": "file", name: "a.pdf", path_display: "/u/a.pdf", id: "id:a" },
            { ".tag": "folder", name: "sub", path_display: "/u/sub", id: "id:s" }
          ],
          cursor: "c1",
          has_more: true
        }
      }),
      filesListFolderContinue: vi.fn().mockResolvedValue({
        result: {
          entries: [
            { ".tag": "file", name: "b.pdf", path_display: "/u/b.pdf", id: "id:b" }
          ],
          cursor: "c2",
          has_more: false
        }
      }),
      filesMoveV2: vi.fn()
    };
    const adapter = adapterWithClient(client);
    const entries = await adapter.listFolderEntries("/u");
    expect(entries.map((e) => e.name)).toEqual(["a.pdf", "sub", "b.pdf"]);
    expect(client.filesListFolder).toHaveBeenCalledWith({ path: "/u", recursive: false });
    expect(client.filesListFolderContinue).toHaveBeenCalledWith({ cursor: "c1" });
  });

  it("returns an empty array for a non-existent folder (path/not_found)", async () => {
    const notFound = Object.assign(new Error("not_found"), {
      error: { error_summary: "path/not_found/.." }
    });
    const client: FakeClient = {
      filesListFolder: vi.fn().mockRejectedValue(notFound),
      filesListFolderContinue: vi.fn(),
      filesMoveV2: vi.fn()
    };
    const adapter = adapterWithClient(client);
    expect(await adapter.listFolderEntries("/missing")).toEqual([]);
  });
});

describe("DropboxStorageAdapter.moveFile", () => {
  it("moves by path with autorename=false by default", async () => {
    const client: FakeClient = {
      filesListFolder: vi.fn(),
      filesListFolderContinue: vi.fn(),
      filesMoveV2: vi.fn().mockResolvedValue({
        result: { metadata: { path_display: "/u/foo.pdf", id: "id:1", rev: "r" } }
      })
    };
    const adapter = adapterWithClient(client);
    const result = await adapter.moveFile({ from: "/u/old.pdf", to: "/u/foo.pdf" });
    expect(client.filesMoveV2).toHaveBeenCalledWith({
      from_path: "/u/old.pdf",
      to_path: "/u/foo.pdf",
      autorename: false
    });
    expect(result.path).toBe("/u/foo.pdf");
  });

  it("moves by Dropbox file id using the id: prefix form", async () => {
    const client: FakeClient = {
      filesListFolder: vi.fn(),
      filesListFolderContinue: vi.fn(),
      filesMoveV2: vi.fn().mockResolvedValue({
        result: { metadata: { path_display: "/u/foo.pdf", id: "id:abc", rev: "r" } }
      })
    };
    const adapter = adapterWithClient(client);
    await adapter.moveFile({ fromId: "id:abc", to: "/u/foo.pdf" });
    expect(client.filesMoveV2).toHaveBeenCalledWith({
      from_path: "id:abc",
      to_path: "/u/foo.pdf",
      autorename: false
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/dropbox-reconcile-ops.test.ts`
Expected: FAIL with `adapter.listFolderEntries is not a function`.

- [ ] **Step 3: Add the two methods to `lib/storage/dropbox-adapter.ts`**

Insert these methods on the `DropboxStorageAdapter` class (place them next to the other public Dropbox helpers, e.g. just below `createTemporaryDownloadLink`):

```ts
  async listFolderEntries(path: string) {
    const client = await this.getClient();
    const entries: Array<{
      ".tag": "file" | "folder" | "deleted";
      name: string;
      path_display: string;
      id?: string;
    }> = [];
    try {
      let response = await client.filesListFolder({ path, recursive: false });
      entries.push(...(response.result.entries as typeof entries));
      while (response.result.has_more) {
        response = await client.filesListFolderContinue({ cursor: response.result.cursor });
        entries.push(...(response.result.entries as typeof entries));
      }
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }
    return entries;
  }

  async moveFile(args: { from?: string; fromId?: string; to: string; autorename?: boolean }) {
    if (!args.from && !args.fromId) {
      throw new Error("moveFile requires either `from` or `fromId`");
    }
    const client = await this.getClient();
    const fromPath = args.fromId ? args.fromId : (args.from as string);
    const result = await client.filesMoveV2({
      from_path: fromPath,
      to_path: args.to,
      autorename: args.autorename ?? false
    });
    const meta = result.result.metadata as { path_display?: string; id?: string; rev?: string };
    return {
      path: meta.path_display ?? args.to,
      fileId: meta.id,
      rev: meta.rev
    };
  }
```

`isNotFoundError` is already defined in `dropbox-adapter.ts`; reuse it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/dropbox-reconcile-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full unit suite to ensure no regression**

Run: `pnpm vitest run tests/unit/`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add lib/storage/dropbox-adapter.ts tests/unit/dropbox-reconcile-ops.test.ts
git commit -m "feat(storage): add listFolderEntries + moveFile to DropboxStorageAdapter"
```

---

## Task 3: Plan builder

**Files:**
- Create: `lib/reconcile-filenames/plan.ts`
- Test: `tests/unit/reconcile-plan.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/reconcile-plan.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildPlan } from "@/lib/reconcile-filenames/plan";

type DbRow = {
  id: string;
  project_id: string;
  dropbox_file_id: string | null;
  dropbox_path: string | null;
  storage_dir: string;
};

function makeDeps(rows: DbRow[], dirListings: Record<string, string[]>) {
  return {
    db: {
      listActiveFileRows: vi.fn(async () => rows)
    },
    dropbox: {
      listFolderEntries: vi.fn(async (path: string) =>
        (dirListings[path] ?? []).map((name) => ({
          ".tag": "file" as const,
          name,
          path_display: `${path}/${name}`
        }))
      )
    }
  };
}

describe("buildPlan", () => {
  it("plans a rename for a prefixed file with no collision", async () => {
    const rows: DbRow[] = [
      {
        id: "f1",
        project_id: "p1",
        dropbox_file_id: "id:1",
        dropbox_path: "/Projects/ACME/uploads/1775067993312-521625632-foo.pdf",
        storage_dir: "/Projects/ACME"
      }
    ];
    const deps = makeDeps(rows, {
      "/Projects/ACME/uploads": ["1775067993312-521625632-foo.pdf"]
    });
    const result = await buildPlan(deps);
    expect(result.plan).toEqual([
      {
        fileId: "f1",
        projectId: "p1",
        dropboxFileId: "id:1",
        fromPath: "/Projects/ACME/uploads/1775067993312-521625632-foo.pdf",
        toPath: "/Projects/ACME/uploads/foo.pdf"
      }
    ]);
    expect(result.orphans).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("auto-suffixes when target name already exists in the directory", async () => {
    const rows: DbRow[] = [
      {
        id: "f1",
        project_id: "p1",
        dropbox_file_id: "id:1",
        dropbox_path: "/p/uploads/1775067993312-521625632-foo.pdf",
        storage_dir: "/p"
      }
    ];
    const deps = makeDeps(rows, {
      "/p/uploads": ["1775067993312-521625632-foo.pdf", "foo.pdf"]
    });
    const result = await buildPlan(deps);
    expect(result.plan[0].toPath).toBe("/p/uploads/foo-2.pdf");
  });

  it("auto-suffixes when two planned rows collapse to the same name", async () => {
    const rows: DbRow[] = [
      {
        id: "f1",
        project_id: "p1",
        dropbox_file_id: "id:1",
        dropbox_path: "/p/uploads/1775067993311-100-foo.pdf",
        storage_dir: "/p"
      },
      {
        id: "f2",
        project_id: "p1",
        dropbox_file_id: "id:2",
        dropbox_path: "/p/uploads/1775067993312-200-foo.pdf",
        storage_dir: "/p"
      }
    ];
    const deps = makeDeps(rows, {
      "/p/uploads": ["1775067993311-100-foo.pdf", "1775067993312-200-foo.pdf"]
    });
    const result = await buildPlan(deps);
    const targets = result.plan.map((r) => r.toPath);
    expect(targets).toEqual(["/p/uploads/foo.pdf", "/p/uploads/foo-2.pdf"]);
  });

  it("skips rows whose basename does not match the prefix pattern", async () => {
    const rows: DbRow[] = [
      {
        id: "f1",
        project_id: "p1",
        dropbox_file_id: "id:1",
        dropbox_path: "/p/uploads/clean.pdf",
        storage_dir: "/p"
      },
      {
        id: "f2",
        project_id: "p1",
        dropbox_file_id: "id:2",
        dropbox_path: null,
        storage_dir: "/p"
      }
    ];
    const deps = makeDeps(rows, { "/p/uploads": ["clean.pdf"] });
    const result = await buildPlan(deps);
    expect(result.plan).toEqual([]);
  });

  it("reports orphan prefixed files in Dropbox with no DB row", async () => {
    const rows: DbRow[] = [];
    const deps = makeDeps(rows, {
      "/p/uploads": ["1775067993312-521625632-orphan.pdf", "clean.pdf"]
    });
    // buildPlan needs to know which dirs to walk; supply via projectsForReconcile
    const result = await buildPlan({
      ...deps,
      listActiveProjectDirs: async () => [{ projectId: "p1", uploadsDir: "/p/uploads" }]
    });
    expect(result.orphans).toEqual([
      {
        projectId: "p1",
        path: "/p/uploads/1775067993312-521625632-orphan.pdf",
        basename: "1775067993312-521625632-orphan.pdf"
      }
    ]);
  });

  it("captures listFolderEntries failures per-project without aborting", async () => {
    const rows: DbRow[] = [
      {
        id: "f1",
        project_id: "p1",
        dropbox_file_id: "id:1",
        dropbox_path: "/p/uploads/1775067993312-521625632-foo.pdf",
        storage_dir: "/p"
      },
      {
        id: "f2",
        project_id: "p2",
        dropbox_file_id: "id:2",
        dropbox_path: "/q/uploads/1775067993312-521625632-bar.pdf",
        storage_dir: "/q"
      }
    ];
    const deps = {
      db: { listActiveFileRows: vi.fn(async () => rows) },
      dropbox: {
        listFolderEntries: vi.fn(async (path: string) => {
          if (path === "/q/uploads") throw new Error("rate limited");
          return [{ ".tag": "file" as const, name: "1775067993312-521625632-foo.pdf", path_display: `${path}/1775067993312-521625632-foo.pdf` }];
        })
      }
    };
    const result = await buildPlan(deps);
    expect(result.plan.map((r) => r.projectId)).toEqual(["p1"]);
    expect(result.errors).toEqual([{ projectId: "p2", error: "rate limited" }]);
  });

  it("respects --limit by truncating the plan after collision resolution", async () => {
    const rows: DbRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `f${i}`,
      project_id: "p1",
      dropbox_file_id: `id:${i}`,
      dropbox_path: `/p/uploads/1775067993312-${i}-doc${i}.pdf`,
      storage_dir: "/p"
    }));
    const deps = makeDeps(rows, {
      "/p/uploads": rows.map((r) => r.dropbox_path!.split("/").pop()!)
    });
    const result = await buildPlan({ ...deps, limit: 2 });
    expect(result.plan).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/reconcile-plan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/reconcile-filenames/plan.ts`**

```ts
import { resolveCollision, stripPrefix } from "./strip";
import type { ErrorRow, OrphanRow, PlanRow } from "./types";

export type PlanDbRow = {
  id: string;
  project_id: string;
  dropbox_file_id: string | null;
  dropbox_path: string | null;
  storage_dir: string;
};

export type PlanDeps = {
  db: { listActiveFileRows(): Promise<PlanDbRow[]> };
  dropbox: {
    listFolderEntries(path: string): Promise<Array<{
      ".tag": "file" | "folder" | "deleted";
      name: string;
      path_display: string;
    }>>;
  };
  listActiveProjectDirs?: () => Promise<Array<{ projectId: string; uploadsDir: string }>>;
  limit?: number;
};

export type PlanResult = {
  plan: PlanRow[];
  orphans: OrphanRow[];
  errors: ErrorRow[];
};

function basename(path: string) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function dirname(path: string) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

export async function buildPlan(deps: PlanDeps): Promise<PlanResult> {
  const rows = await deps.db.listActiveFileRows();

  // Group rows by their /uploads/ directory.
  const rowsByDir = new Map<string, PlanDbRow[]>();
  const projectByDir = new Map<string, string>();
  for (const row of rows) {
    if (!row.dropbox_path) continue;
    const dir = dirname(row.dropbox_path);
    if (!rowsByDir.has(dir)) rowsByDir.set(dir, []);
    rowsByDir.get(dir)!.push(row);
    projectByDir.set(dir, row.project_id);
  }

  // Optionally also walk dirs from listActiveProjectDirs (used for orphan reporting
  // when no DB rows exist in that dir).
  if (deps.listActiveProjectDirs) {
    const extra = await deps.listActiveProjectDirs();
    for (const { projectId, uploadsDir } of extra) {
      if (!rowsByDir.has(uploadsDir)) rowsByDir.set(uploadsDir, []);
      if (!projectByDir.has(uploadsDir)) projectByDir.set(uploadsDir, projectId);
    }
  }

  const plan: PlanRow[] = [];
  const orphans: OrphanRow[] = [];
  const errors: ErrorRow[] = [];

  for (const [dir, dirRows] of rowsByDir.entries()) {
    let entries: Array<{ ".tag": "file" | "folder" | "deleted"; name: string; path_display: string }>;
    try {
      entries = await deps.dropbox.listFolderEntries(dir);
    } catch (error) {
      errors.push({
        projectId: projectByDir.get(dir) ?? "",
        error: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    const taken = new Set<string>();
    for (const e of entries) {
      if (e[".tag"] === "file") taken.add(e.name);
    }

    const dbBasenamesInDir = new Set(
      dirRows.map((r) => (r.dropbox_path ? basename(r.dropbox_path) : ""))
    );

    // Plan renames for matching DB rows.
    for (const row of dirRows) {
      if (!row.dropbox_path) continue;
      const fromBasename = basename(row.dropbox_path);
      const cleanName = stripPrefix(fromBasename);
      if (!cleanName) continue;
      // Remove the source name from `taken` so a row can rename to its own clean form
      // even if the directory currently has both the prefixed and clean variants.
      taken.delete(fromBasename);
      const target = resolveCollision(cleanName, taken);
      plan.push({
        fileId: row.id,
        projectId: row.project_id,
        dropboxFileId: row.dropbox_file_id,
        fromPath: row.dropbox_path,
        toPath: `${dir}/${target}`
      });
    }

    // Orphans: prefixed Dropbox files with no DB row in this dir.
    for (const e of entries) {
      if (e[".tag"] !== "file") continue;
      if (dbBasenamesInDir.has(e.name)) continue;
      if (stripPrefix(e.name) === null) continue;
      orphans.push({
        projectId: projectByDir.get(dir) ?? "",
        path: e.path_display,
        basename: e.name
      });
    }
  }

  const limited = typeof deps.limit === "number" ? plan.slice(0, deps.limit) : plan;
  return { plan: limited, orphans, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/reconcile-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/reconcile-filenames/plan.ts tests/unit/reconcile-plan.test.ts
git commit -m "feat(reconcile): add plan builder for active-project rename ops"
```

---

## Task 4: Apply with progress + concurrency

**Files:**
- Create: `lib/reconcile-filenames/apply.ts`
- Test: `tests/unit/reconcile-apply.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/reconcile-apply.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { applyPlan } from "@/lib/reconcile-filenames/apply";
import type { PlanRow, ProgressFile } from "@/lib/reconcile-filenames/types";

function plan(rows: Partial<PlanRow>[]): PlanRow[] {
  return rows.map((r, i) => ({
    fileId: r.fileId ?? `f${i}`,
    projectId: r.projectId ?? "p",
    dropboxFileId: r.dropboxFileId ?? `id:${i}`,
    fromPath: r.fromPath ?? `/p/uploads/old-${i}.pdf`,
    toPath: r.toPath ?? `/p/uploads/new-${i}.pdf`
  }));
}

function deps(overrides: Partial<Parameters<typeof applyPlan>[0]> = {}) {
  return {
    plan: plan([{}]),
    progress: {} as ProgressFile,
    concurrency: 1,
    flush: vi.fn(async () => {}),
    db: { updateDropboxPath: vi.fn(async () => {}) },
    dropbox: {
      moveFile: vi.fn(async (args: { from?: string; fromId?: string; to: string }) => ({
        path: args.to,
        fileId: args.fromId ?? "id:moved"
      }))
    },
    ...overrides
  };
}

describe("applyPlan", () => {
  it("moves the file then updates DB and marks both flags", async () => {
    const d = deps();
    const result = await applyPlan(d);
    expect(d.dropbox.moveFile).toHaveBeenCalledWith({
      fromId: "id:0",
      to: "/p/uploads/new-0.pdf"
    });
    expect(d.db.updateDropboxPath).toHaveBeenCalledWith({
      fileId: "f0",
      newPath: "/p/uploads/new-0.pdf"
    });
    expect(d.progress["f0"]).toEqual({
      dropbox_done: true,
      db_done: true,
      newPath: "/p/uploads/new-0.pdf"
    });
    expect(result.success).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.error).toBe(0);
    expect(d.flush).toHaveBeenCalled();
  });

  it("skips rows whose progress.db_done is already true", async () => {
    const d = deps({
      progress: { f0: { dropbox_done: true, db_done: true, newPath: "/p/uploads/new-0.pdf" } }
    });
    const result = await applyPlan(d);
    expect(d.dropbox.moveFile).not.toHaveBeenCalled();
    expect(d.db.updateDropboxPath).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("retries the DB update when resuming with dropbox_done but db_done=false", async () => {
    const d = deps({
      progress: {
        f0: { dropbox_done: true, db_done: false, newPath: "/p/uploads/new-0.pdf" }
      }
    });
    await applyPlan(d);
    expect(d.dropbox.moveFile).not.toHaveBeenCalled();
    expect(d.db.updateDropboxPath).toHaveBeenCalledWith({
      fileId: "f0",
      newPath: "/p/uploads/new-0.pdf"
    });
    expect(d.progress["f0"].db_done).toBe(true);
  });

  it("uses fromPath when dropboxFileId is null", async () => {
    const d = deps({ plan: plan([{ dropboxFileId: null, fromPath: "/p/uploads/x.pdf" }]) });
    await applyPlan(d);
    expect(d.dropbox.moveFile).toHaveBeenCalledWith({
      from: "/p/uploads/x.pdf",
      to: "/p/uploads/new-0.pdf"
    });
  });

  it("marks Dropbox not_found errors as skipped without aborting", async () => {
    const notFound = Object.assign(new Error("not_found"), {
      error: { error_summary: "from_lookup/not_found/." }
    });
    const d = deps({
      plan: plan([{}, {}]),
      dropbox: {
        moveFile: vi
          .fn()
          .mockRejectedValueOnce(notFound)
          .mockResolvedValueOnce({ path: "/p/uploads/new-1.pdf", fileId: "id:1" })
      }
    });
    const result = await applyPlan(d);
    expect(result.skipped).toBe(1);
    expect(result.success).toBe(1);
    expect(d.progress["f0"].error).toMatch(/not_found/);
  });

  it("re-resolves a target conflict on the fly and retries once", async () => {
    const conflict = Object.assign(new Error("conflict"), {
      error: { error_summary: "to/conflict/file/." }
    });
    const moveFile = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ path: "/p/uploads/new-0-2.pdf", fileId: "id:0" });
    const d = deps({ dropbox: { moveFile } });
    const result = await applyPlan(d);
    expect(moveFile).toHaveBeenCalledTimes(2);
    expect(moveFile.mock.calls[1][0].to).toBe("/p/uploads/new-0-2.pdf");
    expect(result.success).toBe(1);
  });

  it("records other Dropbox errors and continues", async () => {
    const d = deps({
      plan: plan([{}, {}]),
      dropbox: {
        moveFile: vi
          .fn()
          .mockRejectedValueOnce(new Error("boom"))
          .mockResolvedValueOnce({ path: "/p/uploads/new-1.pdf", fileId: "id:1" })
      }
    });
    const result = await applyPlan(d);
    expect(result.error).toBe(1);
    expect(result.success).toBe(1);
    expect(d.progress["f0"].error).toBe("boom");
  });

  it("respects limit", async () => {
    const d = deps({ plan: plan([{}, {}, {}]), limit: 2 });
    const result = await applyPlan(d);
    expect(result.success).toBe(2);
    expect(d.dropbox.moveFile).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/reconcile-apply.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/reconcile-filenames/apply.ts`**

```ts
import { resolveCollision } from "./strip";
import type { PlanRow, ProgressFile } from "./types";

export type ApplyDeps = {
  plan: PlanRow[];
  progress: ProgressFile;
  concurrency?: number;
  limit?: number;
  flush: () => Promise<void>;
  db: {
    updateDropboxPath(args: { fileId: string; newPath: string }): Promise<void>;
  };
  dropbox: {
    moveFile(args: {
      from?: string;
      fromId?: string;
      to: string;
      autorename?: boolean;
    }): Promise<{ path: string; fileId?: string }>;
    listFolderEntries?: (path: string) => Promise<Array<{ ".tag": string; name: string }>>;
  };
};

export type ApplyResult = {
  success: number;
  skipped: number;
  error: number;
};

function dirname(path: string) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

function basename(path: string) {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const summary = (err as { error?: { error_summary?: string } }).error?.error_summary;
  return typeof summary === "string" && summary.includes("not_found");
}

function isConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const summary = (err as { error?: { error_summary?: string } }).error?.error_summary;
  return typeof summary === "string" && summary.includes("conflict");
}

export async function applyPlan(deps: ApplyDeps): Promise<ApplyResult> {
  const limit = typeof deps.limit === "number" ? deps.plan.slice(0, deps.limit) : deps.plan;
  const concurrency = Math.max(1, deps.concurrency ?? 4);
  const queue = [...limit];
  const result: ApplyResult = { success: 0, skipped: 0, error: 0 };

  let flushChain: Promise<void> = Promise.resolve();
  const scheduleFlush = () => {
    flushChain = flushChain.then(() => deps.flush()).catch(() => {});
    return flushChain;
  };

  async function processRow(row: PlanRow) {
    const existing = deps.progress[row.fileId];
    if (existing?.db_done) {
      result.skipped += 1;
      return;
    }

    let newPath = existing?.newPath;
    if (!existing?.dropbox_done) {
      try {
        const moved = await deps.dropbox.moveFile(
          row.dropboxFileId
            ? { fromId: row.dropboxFileId, to: row.toPath }
            : { from: row.fromPath, to: row.toPath }
        );
        newPath = moved.path;
        deps.progress[row.fileId] = { dropbox_done: true, db_done: false, newPath };
        await scheduleFlush();
      } catch (err) {
        if (isNotFound(err)) {
          deps.progress[row.fileId] = {
            dropbox_done: false,
            db_done: false,
            error: err instanceof Error ? err.message : String(err)
          };
          await scheduleFlush();
          result.skipped += 1;
          return;
        }
        if (isConflict(err)) {
          // Re-resolve against current Dropbox listing of the destination dir.
          const dir = dirname(row.toPath);
          const taken = new Set<string>();
          if (deps.dropbox.listFolderEntries) {
            const entries = await deps.dropbox.listFolderEntries(dir);
            for (const e of entries) {
              if (e[".tag"] === "file") taken.add(e.name);
            }
          } else {
            taken.add(basename(row.toPath));
          }
          const newName = resolveCollision(basename(row.toPath), taken);
          const retryTo = `${dir}/${newName}`;
          try {
            const moved = await deps.dropbox.moveFile(
              row.dropboxFileId
                ? { fromId: row.dropboxFileId, to: retryTo }
                : { from: row.fromPath, to: retryTo }
            );
            newPath = moved.path;
            deps.progress[row.fileId] = { dropbox_done: true, db_done: false, newPath };
            await scheduleFlush();
          } catch (retryErr) {
            deps.progress[row.fileId] = {
              dropbox_done: false,
              db_done: false,
              error: retryErr instanceof Error ? retryErr.message : String(retryErr)
            };
            await scheduleFlush();
            result.error += 1;
            return;
          }
        } else {
          deps.progress[row.fileId] = {
            dropbox_done: false,
            db_done: false,
            error: err instanceof Error ? err.message : String(err)
          };
          await scheduleFlush();
          result.error += 1;
          return;
        }
      }
    }

    if (!newPath) {
      result.error += 1;
      return;
    }

    try {
      await deps.db.updateDropboxPath({ fileId: row.fileId, newPath });
      deps.progress[row.fileId] = {
        dropbox_done: true,
        db_done: true,
        newPath
      };
      await scheduleFlush();
      result.success += 1;
    } catch (err) {
      deps.progress[row.fileId] = {
        dropbox_done: true,
        db_done: false,
        newPath,
        error: err instanceof Error ? err.message : String(err)
      };
      await scheduleFlush();
      result.error += 1;
    }
  }

  async function worker() {
    while (queue.length > 0) {
      const row = queue.shift();
      if (!row) return;
      await processRow(row);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await flushChain;
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/reconcile-apply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/reconcile-filenames/apply.ts tests/unit/reconcile-apply.test.ts
git commit -m "feat(reconcile): add applyPlan with progress + concurrency"
```

---

## Task 5: CLI script (`plan` and `apply` subcommands)

**Files:**
- Create: `scripts/reconcile-active-filenames.ts`

This task wires the building blocks into a runnable script. No new tests — exercised manually via the smoke steps in Task 6.

- [ ] **Step 1: Create `scripts/reconcile-active-filenames.ts`**

```ts
#!/usr/bin/env npx tsx
// scripts/reconcile-active-filenames.ts
// One-time backfill: strip BC2 double-prefix from Dropbox filenames in active projects.
//
// Usage:
//   pnpm tsx scripts/reconcile-active-filenames.ts plan --out tmp/reconcile.plan.json [--limit N]
//   pnpm tsx scripts/reconcile-active-filenames.ts apply --plan tmp/reconcile.plan.json [--concurrency 4] [--limit N]

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname as pathDirname } from "node:path";
import { Pool, type QueryResultRow } from "pg";
import { DropboxStorageAdapter } from "../lib/storage/dropbox-adapter";
import { buildPlan, type PlanDbRow } from "../lib/reconcile-filenames/plan";
import { applyPlan } from "../lib/reconcile-filenames/apply";
import type { ProgressFile } from "../lib/reconcile-filenames/types";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}

function parseFlags() {
  const args = process.argv.slice(2);
  const subcommand = args[0];
  const get = (flag: string) => {
    const entry = args.find((a) => a.startsWith(`--${flag}=`));
    if (entry) return entry.split("=")[1];
    const idx = args.findIndex((a) => a === `--${flag}`);
    if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
    return null;
  };
  return {
    subcommand,
    out: get("out"),
    plan: get("plan"),
    limit: get("limit") ? parseInt(get("limit") as string, 10) : undefined,
    concurrency: get("concurrency") ? parseInt(get("concurrency") as string, 10) : 4
  };
}

async function listActiveFileRows(): Promise<PlanDbRow[]> {
  const { rows } = await query<{
    id: string;
    project_id: string;
    dropbox_file_id: string | null;
    dropbox_path: string | null;
  }>(
    `select pf.id, pf.project_id, pf.dropbox_file_id, pf.dropbox_path
       from project_files pf
       join projects p on p.id = pf.project_id
      where p.archived = false
        and pf.dropbox_path is not null`
  );
  // storage_dir is unused by buildPlan (we derive directory from dropbox_path).
  return rows.map((r) => ({ ...r, storage_dir: "" }));
}

async function ensureDir(filePath: string) {
  await mkdir(pathDirname(filePath), { recursive: true });
}

async function readJsonOr<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function runPlan(opts: { out: string; limit?: number }) {
  const adapter = new DropboxStorageAdapter();
  const result = await buildPlan({
    db: { listActiveFileRows },
    dropbox: { listFolderEntries: (p) => adapter.listFolderEntries(p) },
    limit: opts.limit
  });

  await ensureDir(opts.out);
  await writeFile(opts.out, JSON.stringify(result.plan, null, 2));
  await writeFile(`${opts.out.replace(/\.json$/, "")}.orphans.json`, JSON.stringify(result.orphans, null, 2));
  await writeFile(`${opts.out.replace(/\.json$/, "")}.errors.json`, JSON.stringify(result.errors, null, 2));

  console.log(
    JSON.stringify({
      level: "info",
      msg: "plan complete",
      planRows: result.plan.length,
      orphans: result.orphans.length,
      errors: result.errors.length,
      planFile: opts.out
    })
  );
}

async function runApply(opts: { plan: string; concurrency: number; limit?: number }) {
  const adapter = new DropboxStorageAdapter();
  const planRows = await readJsonOr<Awaited<ReturnType<typeof buildPlan>>["plan"]>(opts.plan, []);
  const progressPath = `${opts.plan.replace(/\.json$/, "")}.progress.json`;
  const progress = await readJsonOr<ProgressFile>(progressPath, {});

  const flush = async () => {
    await writeFile(progressPath, JSON.stringify(progress, null, 2));
  };

  const result = await applyPlan({
    plan: planRows,
    progress,
    concurrency: opts.concurrency,
    limit: opts.limit,
    flush,
    db: {
      updateDropboxPath: async ({ fileId, newPath }) => {
        await query(`update project_files set dropbox_path = $1 where id = $2`, [newPath, fileId]);
      }
    },
    dropbox: {
      moveFile: (args) => adapter.moveFile(args),
      listFolderEntries: (p) => adapter.listFolderEntries(p)
    }
  });

  await flush();
  console.log(
    JSON.stringify({
      level: "info",
      msg: "apply complete",
      success: result.success,
      skipped: result.skipped,
      error: result.error,
      progressFile: progressPath
    })
  );
}

async function main() {
  const flags = parseFlags();
  try {
    if (flags.subcommand === "plan") {
      if (!flags.out) throw new Error("--out is required for plan");
      await runPlan({ out: flags.out, limit: flags.limit });
    } else if (flags.subcommand === "apply") {
      if (!flags.plan) throw new Error("--plan is required for apply");
      await runApply({ plan: flags.plan, concurrency: flags.concurrency, limit: flags.limit });
    } else {
      console.error("Usage: reconcile-active-filenames.ts plan|apply [flags]");
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the script type-checks**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify CLI prints usage on no args**

Run: `pnpm tsx scripts/reconcile-active-filenames.ts`
Expected: prints usage and exits non-zero.

- [ ] **Step 4: Commit**

```bash
git add scripts/reconcile-active-filenames.ts
git commit -m "feat(reconcile): add CLI for plan/apply of active-project rename"
```

---

## Task 6: Manual smoke + handover note

**Files:**
- Modify: `scripts/reconcile-active-filenames.ts` — only if smoke test surfaces a bug. No code change required for this task on its own.

Smoke testing is manual because it requires the staging Dropbox + dev DB. Run it once to validate end to end before pointing at production.

- [ ] **Step 1: Run plan against dev DB + staging Dropbox**

Run:

```bash
mkdir -p tmp
pnpm tsx scripts/reconcile-active-filenames.ts plan --out tmp/reconcile-smoke.plan.json --limit 5
```

Expected: produces `tmp/reconcile-smoke.plan.json`, `…orphans.json`, `…errors.json`. Inspect each file by hand.

- [ ] **Step 2: Apply on a tiny subset**

Run:

```bash
pnpm tsx scripts/reconcile-active-filenames.ts apply --plan tmp/reconcile-smoke.plan.json --limit 2
```

Expected: two files renamed in Dropbox, two `project_files.dropbox_path` rows updated, `tmp/reconcile-smoke.progress.json` written with `dropbox_done: true, db_done: true` for both rows.

Verify:

```sql
select id, filename, dropbox_path
  from project_files
 where id in ('<f0>', '<f1>');
```

- [ ] **Step 3: Re-run apply to confirm idempotency**

Run the same `apply` command again.
Expected: summary shows `skipped: 2`, `success: 0`, `error: 0`. No additional Dropbox calls (verify via Dropbox audit log if needed).

- [ ] **Step 4: Run the unit suite once more**

Run: `pnpm vitest run tests/unit/`
Expected: all green.

- [ ] **Step 5: Commit (no-op or hotfix)**

If smoke testing surfaced a bug, fix it inline and commit. Otherwise no commit needed for this task.

---

## Self-Review Notes

- Spec coverage: scope/match (T3), CLI two-step (T5), collision algorithm (T1+T3), error handling (T4), data structures (T1), file layout (all), testing (T1, T3, T4, T6).
- Placeholders: none — every step has runnable code or commands.
- Type consistency: `PlanRow`, `ProgressRow`, `ProgressFile` defined once in `types.ts` and reused. `dropboxFileId` is consistently nullable; `from`/`fromId`/`to` shape is consistent across `applyPlan`, `moveFile` mock, and adapter implementation.
- Out-of-scope follow-ups (per spec): single-prefix `^\d{13}-` direct uploads, archived projects, orphan reconciliation. Not addressed here intentionally.
