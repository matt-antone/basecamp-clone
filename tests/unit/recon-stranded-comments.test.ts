import { describe, it, expect, vi } from "vitest";
import { resolve } from "path";
import { reconStrandedComments } from "@/lib/imports/migration/stranded-comments";
import type { Query } from "@/lib/imports/migration/jobs";

const FIXTURE_DUMP = resolve(__dirname, "../fixtures/bc2-dump-stranded");

interface FakeRow { rows: unknown[]; rowCount: number }

function makeFakeQ(handlers: Array<(sql: string, params?: unknown[]) => FakeRow | null>): Query {
  return (async (sql: string, params?: unknown[]) => {
    for (const h of handlers) {
      const res = h(sql, params);
      if (res) return res as never;
    }
    return { rows: [], rowCount: 0 } as never;
  }) as Query;
}

describe("reconStrandedComments — happy path", () => {
  it("inserts the missing comment for one mapped thread", async () => {
    const q = makeFakeQ([
      (sql, p) => sql.includes("from import_map_projects")
        ? { rows: [{ local_project_id: "local-project-uuid" }], rowCount: 1 }
        : null,
      (sql, p) => sql.includes("from import_map_threads")
        ? { rows: [{ local_thread_id: "local-thread-uuid" }], rowCount: 1 }
        : null,
      (sql, p) => sql.includes("from import_map_comments")
        ? { rows: [], rowCount: 0 }
        : null,
      (sql) => sql.startsWith("insert into import_map_comments")
        ? { rows: [], rowCount: 1 }
        : null,
      (sql) => sql.startsWith("insert into import_logs")
        ? { rows: [], rowCount: 1 }
        : null,
    ]);

    const createComment = vi.fn().mockResolvedValue({ id: "local-comment-uuid" });

    const result = await reconStrandedComments({
      q,
      jobId: "job-1",
      dumpDir: FIXTURE_DUMP,
      projectIds: [100],
      personMap: new Map([[9001, "user-alice"], [9002, "user-bob"]]),
      createComment,
    });

    expect(createComment).toHaveBeenCalledTimes(2);
    expect(result.totals.success).toBe(2);
    expect(result.totals.failed).toBe(0);
    expect(result.totals.skipped_already_mapped).toBe(0);
    expect(result.perProject[0]).toMatchObject({
      bc2Id: 100,
      localId: "local-project-uuid",
      success: 2,
    });
  });
});
