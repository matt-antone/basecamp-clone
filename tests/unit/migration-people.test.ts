// tests/unit/migration-people.test.ts
import { describe, it, expect, vi } from "vitest";
import { migratePeople } from "@/lib/imports/migration/people";
import type { Query } from "@/lib/imports/migration/jobs";
import type { DumpReader } from "@/lib/imports/dump-reader";

vi.mock("@/lib/imports/bc2-transformer", () => ({
  resolvePerson: vi.fn(async (p: { id: number; email_address: string; name: string }) => ({
    localProfileId: `profile-${p.id}`,
    isLegacy: false,
  })),
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
    const inserts = calls.filter((c) => c.sql.startsWith("insert into import_map_people"));
    expect(inserts).toHaveLength(2);
    const logs = calls.filter((c) => c.sql.startsWith("insert into import_logs"));
    expect(logs.every((l) => l.values[5] === "dump")).toBe(true);
  });

  it("logs failure path with dataSource when resolvePerson throws", async () => {
    const { resolvePerson } = await import("@/lib/imports/bc2-transformer");
    (resolvePerson as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const { calls, q } = fakeQuery();
    const reader = stubReader([{ id: 7, email_address: "x@y.com", name: "X" }]);
    const summary = await migratePeople({ reader, q, jobId: "job-2" });
    expect(summary).toEqual({ success: 0, failed: 1 });
    const logs = calls.filter(c => c.sql.startsWith("insert into import_logs"));
    expect(logs).toHaveLength(1);
    expect(logs[0].values[3]).toBe("failed");
    expect(logs[0].values[4]).toBe("boom");
    expect(logs[0].values[5]).toBe("dump");
  });
});
