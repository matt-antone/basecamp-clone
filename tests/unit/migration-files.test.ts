// tests/unit/migration-files.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { migrateFiles } from "@/lib/imports/migration/files";
import type { Query } from "@/lib/imports/migration/jobs";
import type { DumpReader } from "@/lib/imports/dump-reader";

const { importBc2FileFromAttachment } = vi.hoisted(() => ({
  importBc2FileFromAttachment: vi.fn(async () => ({
    status: "imported" as const,
    localFileId: "f1",
  })),
}));

vi.mock("@/lib/imports/bc2-migrate-single-file", () => ({
  importBc2FileFromAttachment,
}));

vi.mock("@/lib/storage/dropbox-adapter", () => ({
  DropboxStorageAdapter: class {
    uploadComplete = vi.fn();
  },
}));

vi.mock("@/lib/repositories", () => ({
  createFileMetadata: vi.fn(async () => ({ id: "file-uuid" })),
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
        {
          id: 999,
          name: "doc.pdf",
          url: "https://basecamp.com/x/doc.pdf",
          byte_size: 100,
          content_type: "application/pdf",
          created_at: "2024-01-01T00:00:00.000Z",
          creator: { id: 1, name: "A" },
        },
      ],
    })),
  } as unknown as DumpReader;
}

function fakeQuery(opts: { projectFound?: boolean } = {}) {
  const projectFound = opts.projectFound ?? true;
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const q: Query = (async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith("select storage_project_dir, archived from projects")) {
      return projectFound
        ? { rows: [{ storage_project_dir: "/storage/proj", archived: false }] }
        : { rows: [] };
    }
    return { rows: [] };
  }) as Query;
  return { calls, q };
}

describe("migrateFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls importBc2FileFromAttachment once per attachment and counts success", async () => {
    const { calls, q } = fakeQuery();
    const reader = stubReader();
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
    expect(out.files.failed).toBe(0);
    expect(out.files.skipped).toBe(0);

    const logs = calls.filter((c) => c.sql.startsWith("insert into import_logs"));
    const successLog = logs.find(
      (l) => l.values[1] === "file" && l.values[3] === "success",
    );
    expect(successLog).toBeDefined();
    // dataSource=dump propagated from reader to logRecord
    expect(successLog!.values[5]).toBe("dump");
  });

  it("counts skipped when helper returns skipped_existing", async () => {
    importBc2FileFromAttachment.mockResolvedValueOnce({
      status: "skipped_existing" as never,
      localFileId: "f-existing",
    } as never);

    const { q } = fakeQuery();
    const reader = stubReader();
    const out = await migrateFiles({
      reader,
      q,
      jobId: "job-1",
      project: { bc2Id: 100, localId: "proj-uuid", name: "X" },
      downloadEnv: { username: "u", password: "p", userAgent: "ua" },
      personMap: new Map(),
    });

    expect(out.files.success).toBe(0);
    expect(out.files.skipped).toBe(1);
    expect(out.files.failed).toBe(0);
  });

  it("counts failed when helper returns failed status", async () => {
    importBc2FileFromAttachment.mockResolvedValueOnce({
      status: "failed" as never,
      error: "boom",
    } as never);

    const { calls, q } = fakeQuery();
    const reader = stubReader();
    const out = await migrateFiles({
      reader,
      q,
      jobId: "job-1",
      project: { bc2Id: 100, localId: "proj-uuid", name: "X" },
      downloadEnv: { username: "u", password: "p", userAgent: "ua" },
      personMap: new Map(),
    });

    expect(out.files.failed).toBe(1);
    expect(out.files.success).toBe(0);
    const logs = calls.filter((c) => c.sql.startsWith("insert into import_logs"));
    const failedLog = logs.find(
      (l) => l.values[1] === "file" && l.values[3] === "failed",
    );
    expect(failedLog).toBeDefined();
    expect(failedLog!.values[4]).toContain("boom");
  });

  it("logs failed record and returns zeros when project row not found", async () => {
    const { calls, q } = fakeQuery({ projectFound: false });
    const reader = stubReader();
    const out = await migrateFiles({
      reader,
      q,
      jobId: "job-1",
      project: { bc2Id: 100, localId: "proj-uuid", name: "X" },
      downloadEnv: { username: "u", password: "p", userAgent: "ua" },
      personMap: new Map(),
    });

    expect(out.files.success).toBe(0);
    expect(out.files.failed).toBe(0);
    expect(out.files.skipped).toBe(0);
    expect(importBc2FileFromAttachment).not.toHaveBeenCalled();

    const logs = calls.filter((c) => c.sql.startsWith("insert into import_logs"));
    expect(logs).toHaveLength(1);
    expect(logs[0].values[1]).toBe("file");
    expect(logs[0].values[2]).toBe("100");
    expect(logs[0].values[3]).toBe("failed");
    expect(logs[0].values[4]).toBe("project_row_not_found");
    expect(logs[0].values[5]).toBe("api");
  });

  it("logs single failed record and returns zeros when reader.attachments throws", async () => {
    const reader = {
      ...stubReader(),
      attachments: vi.fn(async () => {
        throw new Error("dump read error");
      }),
    } as unknown as DumpReader;

    const { calls, q } = fakeQuery();
    const out = await migrateFiles({
      reader,
      q,
      jobId: "job-1",
      project: { bc2Id: 100, localId: "proj-uuid", name: "X" },
      downloadEnv: { username: "u", password: "p", userAgent: "ua" },
      personMap: new Map(),
    });

    expect(out.files.success).toBe(0);
    expect(out.files.failed).toBe(0);
    expect(out.files.skipped).toBe(0);
    expect(importBc2FileFromAttachment).not.toHaveBeenCalled();

    const logs = calls.filter((c) => c.sql.startsWith("insert into import_logs"));
    expect(logs).toHaveLength(1);
    expect(logs[0].values[1]).toBe("file");
    expect(logs[0].values[3]).toBe("failed");
    expect(String(logs[0].values[4])).toContain("dump read error");
  });
});
