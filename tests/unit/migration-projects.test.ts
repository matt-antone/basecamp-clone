// tests/unit/migration-projects.test.ts
import { describe, it, expect, vi } from "vitest";
import { migrateProjects } from "@/lib/imports/migration/projects";
import type { Query } from "@/lib/imports/migration/jobs";
import type { DumpReader } from "@/lib/imports/dump-reader";
import type { Bc2Project } from "@/lib/imports/bc2-fetcher";
import type { KnownClient } from "@/lib/imports/bc2-client-resolver";

vi.mock("@/lib/imports/bc2-client-resolver", async () => {
  const actual = await vi.importActual<typeof import("@/lib/imports/bc2-client-resolver")>(
    "@/lib/imports/bc2-client-resolver",
  );
  return {
    ...actual,
    resolveTitle: vi.fn((rawTitle: string | null | undefined) => {
      // Simulate a "code" match: client_id is provided, num present, title clean.
      const trimmed = String(rawTitle ?? "").trim();
      return {
        clientId: "client-1",
        matchedBy: "code" as const,
        code: "ACME",
        num: "001",
        title: trimmed.replace(/^ACME-001\s*/i, "") || trimmed,
        confidence: "high" as const,
      };
    }),
  };
});

vi.mock("@/lib/project-storage", () => ({
  sanitizeDropboxFolderTitle: vi.fn((s: string) =>
    String(s).replace(/[^A-Za-z0-9 _-]/g, "").trim() || "Untitled",
  ),
}));

function stubReader(active: Bc2Project[], archived: Bc2Project[]): DumpReader {
  return {
    people: vi.fn(),
    activeProjects: vi.fn(async () => ({ source: "dump", body: active })),
    archivedProjects: vi.fn(async () => ({ source: "dump", body: archived })),
    topics: vi.fn(),
    topicDetail: vi.fn(),
    attachments: vi.fn(),
  } as unknown as DumpReader;
}

interface QueryHandler {
  match: (sql: string) => boolean;
  handle: (
    sql: string,
    values: unknown[],
  ) => { rows: Array<Record<string, unknown>> };
}

function fakeQuery(handlers: QueryHandler[] = []) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const q: Query = (async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    for (const h of handlers) {
      if (h.match(sql)) return h.handle(sql, values) as { rows: never[] };
    }
    return { rows: [] };
  }) as Query;
  return { calls, q };
}

const knownClients: KnownClient[] = [
  { id: "client-1", code: "ACME", name: "ACME Co" },
];

function makeProject(id: number, name: string, archived = false): Bc2Project {
  return {
    id,
    name,
    description: "desc",
    archived,
    created_at: "2023-01-15T10:00:00.000Z",
    updated_at: "2023-02-20T11:30:00.000Z",
  };
}

describe("migrateProjects", () => {
  it("inserts active + archived projects with raw SQL and logs dataSource=dump", async () => {
    const handlers: QueryHandler[] = [
      {
        match: (sql) => sql.startsWith("select local_project_id from import_map_projects"),
        handle: () => ({ rows: [] }),
      },
      {
        match: (sql) => sql.startsWith("select name from clients"),
        handle: () => ({ rows: [{ name: "ACME Co" }] }),
      },
      {
        match: (sql) => sql.includes("coalesce(max(project_seq)"),
        handle: () => ({ rows: [{ next_seq: 1 }] }),
      },
      {
        match: (sql) => sql.trim().startsWith("insert into projects"),
        handle: (_sql, values) => ({
          rows: [{ id: `local-${values[0]}` }],
        }),
      },
    ];
    const { calls, q } = fakeQuery(handlers);

    const reader = stubReader(
      [makeProject(101, "ACME-001 Sample", false)],
      [makeProject(202, "ACME-001 Sample Old", true)],
    );

    const result = await migrateProjects({
      reader,
      q,
      jobId: "job-1",
      filter: "all",
      limit: null,
      onlyProjectId: null,
      knownClients,
    });

    expect(result.migrated).toHaveLength(2);
    expect(result.migrated.map((m) => m.bc2Id).sort()).toEqual([101, 202]);

    const inserts = calls.filter((c) => c.sql.trim().startsWith("insert into projects"));
    expect(inserts).toHaveLength(2);
    // Confirm column list contains all 13 names
    for (const ins of inserts) {
      const sql = ins.sql;
      for (const col of [
        "name",
        "slug",
        "description",
        "client_id",
        "archived",
        "created_by",
        "project_seq",
        "project_code",
        "client_slug",
        "project_slug",
        "storage_project_dir",
        "created_at",
        "updated_at",
      ]) {
        expect(sql).toContain(col);
      }
      expect(sql).toContain("on conflict (project_code)");
    }

    // archived flag propagated correctly
    const activeInsert = inserts.find((c) => (c.values[3] as string) === "client-1" && c.values[4] === false);
    const archivedInsert = inserts.find((c) => c.values[4] === true);
    expect(activeInsert).toBeDefined();
    expect(archivedInsert).toBeDefined();

    // created_at/updated_at parsed to Date
    expect(activeInsert!.values[11]).toBeInstanceOf(Date);
    expect(activeInsert!.values[12]).toBeInstanceOf(Date);

    // import_map_projects insert
    const mapInserts = calls.filter((c) =>
      c.sql.startsWith("insert into import_map_projects"),
    );
    expect(mapInserts).toHaveLength(2);

    // logRecord with dataSource=dump
    const logs = calls.filter((c) => c.sql.startsWith("insert into import_logs"));
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.values[5] === "dump")).toBe(true);
    expect(logs.every((l) => l.values[3] === "success")).toBe(true);
  });

  it("returns existing mapping without re-inserting when basecamp_project_id already mapped", async () => {
    const handlers: QueryHandler[] = [
      {
        match: (sql) => sql.startsWith("select local_project_id from import_map_projects"),
        handle: () => ({ rows: [{ local_project_id: "existing-uuid" }] }),
      },
    ];
    const { calls, q } = fakeQuery(handlers);
    const reader = stubReader([makeProject(303, "ACME-002 Reuse")], []);

    const result = await migrateProjects({
      reader,
      q,
      jobId: "job-2",
      filter: "active",
      limit: null,
      onlyProjectId: null,
      knownClients,
    });

    expect(result.migrated).toEqual([
      { bc2Id: 303, localId: "existing-uuid", name: "ACME-002 Reuse" },
    ]);

    const projInserts = calls.filter((c) => c.sql.trim().startsWith("insert into projects"));
    expect(projInserts).toHaveLength(0);

    const mapInserts = calls.filter((c) => c.sql.startsWith("insert into import_map_projects"));
    expect(mapInserts).toHaveLength(0);

    const logs = calls.filter((c) => c.sql.startsWith("insert into import_logs"));
    expect(logs).toHaveLength(1);
    expect(logs[0].values[5]).toBe("dump");
    expect(logs[0].values[3]).toBe("success");
  });
});
