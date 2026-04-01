import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertThumbnailJobMock = vi.fn();
const notifyThumbnailWorkerBestEffortMock = vi.fn();

vi.mock("@/lib/repositories", () => ({
  upsertThumbnailJob: upsertThumbnailJobMock
}));

vi.mock("@/lib/thumbnail-worker-notify", () => ({
  notifyThumbnailWorkerBestEffort: notifyThumbnailWorkerBestEffortMock
}));

describe("shouldEnqueueThumbnailForProject", () => {
  it("returns false only when archived is true", async () => {
    const { shouldEnqueueThumbnailForProject } = await import("@/lib/thumbnail-enqueue-after-save");
    expect(shouldEnqueueThumbnailForProject({ archived: true })).toBe(false);
    expect(shouldEnqueueThumbnailForProject({ archived: false })).toBe(true);
    expect(shouldEnqueueThumbnailForProject({})).toBe(true);
  });
});

describe("enqueueThumbnailJobAndNotifyBestEffort", () => {
  beforeEach(() => {
    upsertThumbnailJobMock.mockReset();
    notifyThumbnailWorkerBestEffortMock.mockReset();
    notifyThumbnailWorkerBestEffortMock.mockResolvedValue(undefined);
  });

  it("skips upsert and notify when projectArchived is true", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { enqueueThumbnailJobAndNotifyBestEffort } = await import(
      "@/lib/thumbnail-enqueue-after-save"
    );
    await enqueueThumbnailJobAndNotifyBestEffort({
      projectId: "p1",
      fileRecord: { id: "f1" },
      requestId: "req-arch",
      projectArchived: true
    });
    expect(upsertThumbnailJobMock).not.toHaveBeenCalled();
    expect(notifyThumbnailWorkerBestEffortMock).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      "thumbnail_enqueue_skipped",
      expect.objectContaining({
        projectId: "p1",
        requestId: "req-arch",
        reason: "archived_project"
      })
    );
    debugSpy.mockRestore();
  });

  it("skips upsert and notify when thumbnail_url is a non-empty string", async () => {
    const { enqueueThumbnailJobAndNotifyBestEffort } = await import(
      "@/lib/thumbnail-enqueue-after-save"
    );
    await enqueueThumbnailJobAndNotifyBestEffort({
      projectId: "p1",
      fileRecord: { id: "f1", thumbnail_url: " https://x/y.jpg " },
      requestId: "req-1"
    });
    expect(upsertThumbnailJobMock).not.toHaveBeenCalled();
    expect(notifyThumbnailWorkerBestEffortMock).not.toHaveBeenCalled();
  });

  it("does not call notify when upsert returns permanent_failure", async () => {
    upsertThumbnailJobMock.mockResolvedValue({
      action: "permanent_failure",
      job: { id: "j1" }
    });
    const { enqueueThumbnailJobAndNotifyBestEffort } = await import(
      "@/lib/thumbnail-enqueue-after-save"
    );
    await enqueueThumbnailJobAndNotifyBestEffort({
      projectId: "p1",
      fileRecord: {
        id: "f1",
        thumbnail_url: null,
        dropbox_file_id: "d1",
        dropbox_path: "/p",
        filename: "a.pdf",
        mime_type: "application/pdf"
      },
      requestId: "req-1"
    });
    expect(upsertThumbnailJobMock).toHaveBeenCalledWith({ projectFileId: "f1" });
    expect(notifyThumbnailWorkerBestEffortMock).not.toHaveBeenCalled();
  });

  it("calls notify with processing when job action is deduped", async () => {
    upsertThumbnailJobMock.mockResolvedValue({
      action: "deduped",
      job: { id: "job-dedup" }
    });
    const { enqueueThumbnailJobAndNotifyBestEffort } = await import(
      "@/lib/thumbnail-enqueue-after-save"
    );
    await enqueueThumbnailJobAndNotifyBestEffort({
      projectId: "proj-1",
      fileRecord: {
        id: "file-1",
        dropbox_file_id: "id:abc",
        dropbox_path: "/x",
        filename: "r.pdf",
        mime_type: "application/pdf"
      },
      requestId: "r1"
    });
    expect(notifyThumbnailWorkerBestEffortMock).toHaveBeenCalledWith({
      projectId: "proj-1",
      fileId: "file-1",
      requestId: "r1",
      responseStatus: "processing",
      fileRecord: expect.objectContaining({ id: "file-1" }),
      jobId: "job-dedup"
    });
  });

  it("calls notify with queued when job action is inserted", async () => {
    upsertThumbnailJobMock.mockResolvedValue({
      action: "inserted",
      job: { id: "job-new" }
    });
    const { enqueueThumbnailJobAndNotifyBestEffort } = await import(
      "@/lib/thumbnail-enqueue-after-save"
    );
    await enqueueThumbnailJobAndNotifyBestEffort({
      projectId: "proj-1",
      fileRecord: {
        id: "file-1",
        dropbox_file_id: "id:abc",
        dropbox_path: "/x",
        filename: "r.pdf",
        mime_type: "application/pdf"
      }
    });
    expect(notifyThumbnailWorkerBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        responseStatus: "queued",
        jobId: "job-new"
      })
    );
    expect(notifyThumbnailWorkerBestEffortMock.mock.calls[0]?.[0].requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("swallows upsertThumbnailJob rejection and logs", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    upsertThumbnailJobMock.mockRejectedValue(new Error("db down"));
    const { enqueueThumbnailJobAndNotifyBestEffort } = await import(
      "@/lib/thumbnail-enqueue-after-save"
    );
    await expect(
      enqueueThumbnailJobAndNotifyBestEffort({
        projectId: "p1",
        fileRecord: { id: "f1" },
        requestId: "req-x"
      })
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "thumbnail_enqueue_after_save_failed",
      expect.objectContaining({ reason: "db down", fileId: "f1" })
    );
    warnSpy.mockRestore();
  });

  it("swallows notify rejection and logs", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    upsertThumbnailJobMock.mockResolvedValue({
      action: "inserted",
      job: { id: "j1" }
    });
    notifyThumbnailWorkerBestEffortMock.mockRejectedValue(new Error("network"));
    const { enqueueThumbnailJobAndNotifyBestEffort } = await import(
      "@/lib/thumbnail-enqueue-after-save"
    );
    await expect(
      enqueueThumbnailJobAndNotifyBestEffort({
        projectId: "p1",
        fileRecord: { id: "f1" },
        requestId: "req-x"
      })
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "thumbnail_enqueue_after_save_failed",
      expect.objectContaining({ reason: "network" })
    );
    warnSpy.mockRestore();
  });
});
