// tests/unit/sync/prod-to-test/phases/files.test.ts
import { describe, it, expect, vi } from "vitest";
import { runFilesPhase } from "@/lib/sync/prod-to-test/phases/files";
import type { PhaseCtx } from "@/lib/sync/prod-to-test/phases/types";

function makeCtx(downloadOk: boolean, uploadOk: boolean): PhaseCtx {
  const watermarks = new Map();
  watermarks.set("files", new Date(0));
  const fakeBucket = {
    download: vi.fn(async () =>
      downloadOk
        ? { data: new Blob([new Uint8Array([1, 2, 3])]), error: null }
        : { data: null, error: new Error("not found") }
    ),
    upload: vi.fn(async () =>
      uploadOk ? { data: { path: "ok" }, error: null } : { data: null, error: new Error("upload fail") }
    ),
  };
  const fakeStorage = { from: vi.fn(() => fakeBucket) };
  return {
    prod: { query: vi.fn() } as any,
    test: { query: vi.fn() } as any,
    prodStorage: { storage: fakeStorage } as any,
    testStorage: { storage: fakeStorage } as any,
    watermarks,
    flags: { phase: null, limitPerPhase: null, noBackup: false, iKnowWhatImDoing: false },
    log: () => {},
  };
}

const sampleProdFile = {
  id: "f1",
  project_id: "p1",
  thread_id: null,
  comment_id: null,
  uploader_user_id: "prod-user-1",
  filename: "foo.png",
  mime_type: "image/png",
  size_bytes: 1234,
  dropbox_file_id: "dbx-1",
  dropbox_path: "/foo.png",
  checksum: "abc",
  created_at: new Date("2026-04-30T00:00:00Z"),
};

describe("runFilesPhase", () => {
  it("downloads from prod, uploads to test, inserts row + map", async () => {
    const ctx = makeCtx(true, true);
    (ctx.prod.query as any).mockResolvedValue({ rows: [sampleProdFile] });
    (ctx.test as any).query = vi.fn((sql: string) => {
      if (/from import_map_prod_files/i.test(sql)) return { rows: [] };
      if (/from import_map_prod_projects/i.test(sql)) return { rows: [{ local_id: "lp" }] };
      if (/from import_map_prod_users/i.test(sql)) return { rows: [{ local_id: "lu" }] };
      return { rows: [] };
    });
    const result = await runFilesPhase(ctx);
    expect(result.inserted).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("fails the row when upload fails (no insert, watermark held)", async () => {
    const ctx = makeCtx(true, false);
    (ctx.prod.query as any).mockResolvedValue({ rows: [sampleProdFile] });
    (ctx.test as any).query = vi.fn((sql: string) => {
      if (/from import_map_prod_files/i.test(sql)) return { rows: [] };
      if (/from import_map_prod_projects/i.test(sql)) return { rows: [{ local_id: "lp" }] };
      if (/from import_map_prod_users/i.test(sql)) return { rows: [{ local_id: "lu" }] };
      return { rows: [] };
    });
    const result = await runFilesPhase(ctx);
    expect(result.inserted).toBe(0);
    expect(result.failed).toBe(1);
  });
});
