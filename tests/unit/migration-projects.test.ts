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
    expect(out.migrated.map((p) => p.bc2Id).sort()).toEqual([100, 200]);
    const logs = calls.filter((c) => c.sql.startsWith("insert into import_logs"));
    expect(logs.every((l) => l.values[5] === "dump")).toBe(true);
  });
});
