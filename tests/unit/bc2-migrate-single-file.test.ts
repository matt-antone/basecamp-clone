import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importBc2FileFromAttachment } from "@/lib/imports/bc2-migrate-single-file";

describe("importBc2FileFromAttachment", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  const baseAttachment = {
    id: 99,
    name: "a.png",
    content_type: "image/png",
    byte_size: 3,
    url: "https://example.com/a",
    created_at: "",
    creator: { id: 1, name: "A" }
  };

  it("returns existing local file id when import_map_files already has basecamp id", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ local_file_id: "already-local" }]
    });
    const result = await importBc2FileFromAttachment({
      query: query as never,
      jobId: "job-1",
      projectLocalId: "proj-1",
      storageDir: "/root/CODE/client-proj",
      personMap: new Map([[1, "profile-1"]]),
      attachment: baseAttachment,
      threadId: null,
      commentId: null,
      downloadEnv: { username: "u", password: "p", userAgent: "UA" },
      adapter: { uploadComplete: vi.fn() },
      createFileMetadata: vi.fn(),
      logRecord: vi.fn(),
      incrementCounters: vi.fn()
    });
    expect(result).toEqual({ status: "skipped_existing", localFileId: "already-local" });
    expect(query).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("imports when map is empty: download, upload, createFileMetadata, insert map", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // import_map miss
      .mockResolvedValueOnce({ rows: [] }); // insert ok

    const uploadComplete = vi.fn().mockResolvedValue({
      fileId: "drop-1",
      path: "/x/a.png",
      rev: "r"
    });

    const createFileMetadata = vi.fn().mockResolvedValue({ id: "file-row-1" });
    const logRecord = vi.fn();
    const incrementCounters = vi.fn();

    const result = await importBc2FileFromAttachment({
      query: query as never,
      jobId: "job-1",
      projectLocalId: "proj-1",
      storageDir: "/root/CODE/client-proj",
      personMap: new Map([[1, "profile-1"]]),
      attachment: baseAttachment,
      threadId: "t1",
      commentId: "c1",
      downloadEnv: { username: "u", password: "p", userAgent: "UA" },
      adapter: { uploadComplete },
      createFileMetadata: createFileMetadata as never,
      logRecord,
      incrementCounters,
      retryAttempts: 1
    });

    expect(result).toEqual({ status: "imported", localFileId: "file-row-1" });
    expect(uploadComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "99",
        filename: "a.png",
        mimeType: "image/png"
      })
    );
    expect(createFileMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        threadId: "t1",
        commentId: "c1",
        dropboxFileId: "drop-1"
      })
    );
    expect(query).toHaveBeenCalledWith(
      "insert into import_map_files (basecamp_file_id, local_file_id) values ($1, $2)",
      ["99", "file-row-1"]
    );
    expect(logRecord).toHaveBeenCalledWith("job-1", "file", "99", "success");
    expect(incrementCounters).toHaveBeenCalledWith("job-1", 1, 0);
  });
});
