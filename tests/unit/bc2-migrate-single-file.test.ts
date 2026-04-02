import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importBc2FileFromAttachment } from "@/lib/imports/bc2-migrate-single-file";

const { enqueueThumbnailJobAndNotifyBestEffortMock } = vi.hoisted(() => ({
  enqueueThumbnailJobAndNotifyBestEffortMock: vi.fn()
}));

vi.mock("@/lib/thumbnail-enqueue-after-save", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/thumbnail-enqueue-after-save")>();
  return {
    ...actual,
    enqueueThumbnailJobAndNotifyBestEffort: enqueueThumbnailJobAndNotifyBestEffortMock
  };
});

describe("importBc2FileFromAttachment", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    enqueueThumbnailJobAndNotifyBestEffortMock.mockReset();
    enqueueThumbnailJobAndNotifyBestEffortMock.mockResolvedValue(undefined);
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
    expect(enqueueThumbnailJobAndNotifyBestEffortMock).not.toHaveBeenCalled();
  });

  it("imports when map is empty: download, upload, createFileMetadata, insert map", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // import_map miss
      .mockResolvedValueOnce({ rows: [] }) // project_files: no bc row yet
      .mockResolvedValueOnce({ rows: [] }); // insert map ok

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
        dropboxFileId: "drop-1",
        bcAttachmentId: "99"
      })
    );
    expect(query).toHaveBeenCalledWith(
      "insert into import_map_files (basecamp_file_id, local_file_id) values ($1, $2)",
      ["99", "file-row-1"]
    );
    expect(logRecord).toHaveBeenCalledWith("job-1", "file", "99", "success");
    expect(incrementCounters).toHaveBeenCalledWith("job-1", 1, 0);
    expect(enqueueThumbnailJobAndNotifyBestEffortMock).toHaveBeenCalledTimes(1);
    expect(enqueueThumbnailJobAndNotifyBestEffortMock).toHaveBeenCalledWith({
      projectId: "proj-1",
      fileRecord: { id: "file-row-1" },
      requestId: "bc2-job-1-99"
    });
  });

  it("does not enqueue thumbnails when projectArchived is true", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const createFileMetadata = vi.fn().mockResolvedValue({ id: "file-row-arch" });

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
      adapter: { uploadComplete: vi.fn().mockResolvedValue({ fileId: "d1", path: "/p", rev: "r" }) },
      createFileMetadata: createFileMetadata as never,
      logRecord: vi.fn(),
      incrementCounters: vi.fn(),
      projectArchived: true,
      retryAttempts: 1
    });

    expect(result).toEqual({ status: "imported", localFileId: "file-row-arch" });
    expect(enqueueThumbnailJobAndNotifyBestEffortMock).not.toHaveBeenCalled();
  });

  it("imports with thread only (message attachment; comment_id null)", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const createFileMetadata = vi.fn().mockResolvedValue({ id: "file-msg-1" });

    const result = await importBc2FileFromAttachment({
      query: query as never,
      jobId: "job-1",
      projectLocalId: "proj-1",
      storageDir: "/root/CODE/client-proj",
      personMap: new Map([[1, "profile-1"]]),
      attachment: baseAttachment,
      threadId: "thread-only",
      commentId: null,
      downloadEnv: { username: "u", password: "p", userAgent: "UA" },
      adapter: { uploadComplete: vi.fn().mockResolvedValue({ fileId: "d1", path: "/p", rev: "r" }) },
      createFileMetadata: createFileMetadata as never,
      logRecord: vi.fn(),
      incrementCounters: vi.fn(),
      retryAttempts: 1
    });

    expect(result.status).toBe("imported");
    expect(createFileMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-only",
        commentId: null,
        bcAttachmentId: "99"
      })
    );
  });

  it("patches thread_id when import_map_files hit and caller provides threadId (branch 1)", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ local_file_id: "existing-local" }] }) // import_map hit
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await importBc2FileFromAttachment({
      query: query as never,
      jobId: "job-1",
      projectLocalId: "proj-1",
      storageDir: "/root/CODE/client-proj",
      personMap: new Map([[1, "profile-1"]]),
      attachment: baseAttachment,
      threadId: "t-new",
      commentId: null,
      downloadEnv: { username: "u", password: "p", userAgent: "UA" },
      adapter: { uploadComplete: vi.fn() },
      createFileMetadata: vi.fn(),
      logRecord: vi.fn(),
      incrementCounters: vi.fn()
    });

    expect(result).toEqual({ status: "skipped_existing", localFileId: "existing-local" });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("update project_files"),
      ["existing-local", "t-new", null]
    );
  });

  it("patches thread_id/comment_id when bc_attachment_id hit and caller provides linkage (branch 2)", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // import_map miss
      .mockResolvedValueOnce({ rows: [{ id: "orphan-2" }] }) // project_files bc hit
      .mockResolvedValueOnce({ rows: [] }) // insert map
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await importBc2FileFromAttachment({
      query: query as never,
      jobId: "job-1",
      projectLocalId: "proj-1",
      storageDir: "/root/CODE/client-proj",
      personMap: new Map([[1, "profile-1"]]),
      attachment: baseAttachment,
      threadId: "t-link",
      commentId: "c-link",
      downloadEnv: { username: "u", password: "p", userAgent: "UA" },
      adapter: { uploadComplete: vi.fn() },
      createFileMetadata: vi.fn(),
      logRecord: vi.fn(),
      incrementCounters: vi.fn()
    });

    expect(result).toEqual({ status: "skipped_existing", localFileId: "orphan-2" });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("update project_files"),
      ["orphan-2", "t-link", "c-link"]
    );
  });

  it("does not call UPDATE when threadId and commentId are both null (null guard)", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ local_file_id: "null-guard-local" }] }); // import_map hit

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

    expect(result).toEqual({ status: "skipped_existing", localFileId: "null-guard-local" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("skips when project_files already has bc_attachment_id but import_map is empty", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "orphan-local" }] })
      .mockResolvedValueOnce({ rows: [] });

    const createFileMetadata = vi.fn();
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
      createFileMetadata: createFileMetadata as never,
      logRecord: vi.fn(),
      incrementCounters: vi.fn()
    });

    expect(result).toEqual({ status: "skipped_existing", localFileId: "orphan-local" });
    expect(fetch).not.toHaveBeenCalled();
    expect(createFileMetadata).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      "select id from project_files where project_id = $1 and bc_attachment_id = $2 limit 1",
      ["proj-1", "99"]
    );
    expect(query).toHaveBeenCalledWith(
      "insert into import_map_files (basecamp_file_id, local_file_id) values ($1, $2) on conflict (basecamp_file_id) do nothing",
      ["99", "orphan-local"]
    );
  });

  it("patches linkage in unique-violation race branch when caller provides linkage", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const uniqueViolation = Object.assign(new Error("duplicate key"), { code: "23505" });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // import_map miss
      .mockResolvedValueOnce({ rows: [] }) // project_files bc miss
      .mockRejectedValueOnce(uniqueViolation) // insert map unique violation
      .mockResolvedValueOnce({ rows: [{ local_file_id: "race-local-1" }] }) // select raced local_file_id
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await importBc2FileFromAttachment({
      query: query as never,
      jobId: "job-1",
      projectLocalId: "proj-1",
      storageDir: "/root/CODE/client-proj",
      personMap: new Map([[1, "profile-1"]]),
      attachment: baseAttachment,
      threadId: "thread-race",
      commentId: null,
      downloadEnv: { username: "u", password: "p", userAgent: "UA" },
      adapter: { uploadComplete: vi.fn().mockResolvedValue({ fileId: "drop", path: "/x/a.png", rev: "r" }) },
      createFileMetadata: vi.fn().mockResolvedValue({ id: "fresh-local-id" }) as never,
      logRecord: vi.fn(),
      incrementCounters: vi.fn(),
      retryAttempts: 1
    });

    expect(result).toEqual({ status: "skipped_existing", localFileId: "race-local-1" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("update project_files"), [
      "race-local-1",
      "thread-race",
      null
    ]);
  });

  it("does not patch linkage in unique-violation race branch when both linkage args are null", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const uniqueViolation = Object.assign(new Error("duplicate key"), { code: "23505" });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // import_map miss
      .mockResolvedValueOnce({ rows: [] }) // project_files bc miss
      .mockRejectedValueOnce(uniqueViolation) // insert map unique violation
      .mockResolvedValueOnce({ rows: [{ local_file_id: "race-local-2" }] }); // select raced local_file_id

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
      adapter: { uploadComplete: vi.fn().mockResolvedValue({ fileId: "drop", path: "/x/a.png", rev: "r" }) },
      createFileMetadata: vi.fn().mockResolvedValue({ id: "fresh-local-id" }) as never,
      logRecord: vi.fn(),
      incrementCounters: vi.fn(),
      retryAttempts: 1
    });

    expect(result).toEqual({ status: "skipped_existing", localFileId: "race-local-2" });
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("update project_files"), expect.anything());
  });
});
