import { describe, expect, it, vi, beforeEach } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: queryMock
}));

// Import after mock is set up
const { upsertThumbnailJob } = await import("@/lib/repositories");

function makeJobRow(overrides: Partial<{
  id: string;
  project_file_id: string;
  status: string;
  attempt_count: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}> = {}) {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    project_file_id: "file-1",
    status: "queued",
    attempt_count: 0,
    next_attempt_at: now,
    last_error: null,
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

describe("upsertThumbnailJob", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("inserts a new job when none exists", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // SELECT
      .mockResolvedValueOnce({ rows: [makeJobRow()] }); // INSERT

    const result = await upsertThumbnailJob({ projectFileId: "file-1" });

    expect(result.action).toBe("inserted");
  });

  it("dedupes a fresh queued job", async () => {
    const freshUpdatedAt = new Date().toISOString();
    queryMock
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: "queued", updated_at: freshUpdatedAt })] }) // SELECT
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: "queued", updated_at: new Date().toISOString() })] }); // UPDATE

    const result = await upsertThumbnailJob({ projectFileId: "file-1" });

    expect(result.action).toBe("deduped");
  });

  it("dedupes a fresh processing job", async () => {
    const freshUpdatedAt = new Date().toISOString();
    queryMock
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: "processing", updated_at: freshUpdatedAt })] }) // SELECT
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: "processing", updated_at: new Date().toISOString() })] }); // UPDATE

    const result = await upsertThumbnailJob({ projectFileId: "file-1" });

    expect(result.action).toBe("deduped");
  });

  it("resets a stale queued job (stuck > 10 minutes)", async () => {
    const staleUpdatedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    queryMock
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: "queued", updated_at: staleUpdatedAt })] }) // SELECT
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: "queued", attempt_count: 0 })] }); // UPDATE (restart)

    const result = await upsertThumbnailJob({ projectFileId: "file-1" });

    expect(result.action).toBe("inserted");
  });

  it("resets a stale processing job (stuck > 10 minutes)", async () => {
    const staleUpdatedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    queryMock
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: "processing", updated_at: staleUpdatedAt })] }) // SELECT
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: "queued", attempt_count: 0 })] }); // UPDATE (restart)

    const result = await upsertThumbnailJob({ projectFileId: "file-1" });

    expect(result.action).toBe("inserted");
  });

  it("does not dedupe a job exactly at the staleness boundary (just under 10 min)", async () => {
    const justFreshUpdatedAt = new Date(Date.now() - 9 * 60 * 1000).toISOString();
    queryMock
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: "queued", updated_at: justFreshUpdatedAt })] })
      .mockResolvedValueOnce({ rows: [makeJobRow()] });

    const result = await upsertThumbnailJob({ projectFileId: "file-1" });

    expect(result.action).toBe("deduped");
  });

  it("resets a succeeded job to reprocess", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: "succeeded" })] }) // SELECT
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: "queued", attempt_count: 0 })] }); // UPDATE (restart)

    const result = await upsertThumbnailJob({ projectFileId: "file-1" });

    expect(result.action).toBe("inserted");
  });

  it("resets a failed job to retry", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: "failed", last_error: "timeout" })] }) // SELECT
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: "queued", attempt_count: 0, last_error: null })] }); // UPDATE

    const result = await upsertThumbnailJob({ projectFileId: "file-1" });

    expect(result.action).toBe("inserted");
  });
});
