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
