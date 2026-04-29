import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: queryMock
}));

describe("touchProjectActivity", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
  });

  it("issues an UPDATE bumping last_activity_at with greatest(..., now())", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { touchProjectActivity } = await import("@/lib/repositories");
    await touchProjectActivity("project-abc");

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("update projects");
    expect(sql).toContain("last_activity_at");
    expect(sql).toContain("greatest");
    expect(sql).toContain("now()");
    expect(params).toEqual(["project-abc"]);
  });

  it("when given activityAt, uses greatest(..., $2::timestamptz)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const at = new Date("2020-06-01T12:00:00.000Z");
    const { touchProjectActivity } = await import("@/lib/repositories");
    await touchProjectActivity("project-abc", at);

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("$2::timestamptz");
    expect(params).toEqual(["project-abc", at]);
  });

  it("does not throw when last_activity_at column does not yet exist", async () => {
    queryMock.mockRejectedValueOnce(new Error('column "last_activity_at" does not exist'));

    const { touchProjectActivity } = await import("@/lib/repositories");
    await expect(touchProjectActivity("project-abc")).resolves.toBeUndefined();
  });
});

describe("createThread touches project activity", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
  });

  it("calls UPDATE last_activity_at after inserting the thread", async () => {
    // First call: the thread INSERT
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "thread-1", title: "Hello", project_id: "proj-1" }]
    });
    // Second call: the activity touch UPDATE
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { createThread } = await import("@/lib/repositories");
    await createThread({
      projectId: "proj-1",
      title: "Hello",
      bodyMarkdown: "world",
      authorUserId: "user-1"
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const [touchSql, touchParams] = queryMock.mock.calls[1];
    expect(touchSql).toContain("update projects");
    expect(touchSql).toContain("greatest");
    expect(touchSql).toContain("now()");
    expect(touchParams).toEqual(["proj-1"]);
  });
});

describe("createComment touches project activity", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
  });

  it("calls UPDATE last_activity_at after inserting the comment", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "comment-1", project_id: "proj-1" }]
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { createComment } = await import("@/lib/repositories");
    await createComment({
      projectId: "proj-1",
      threadId: "thread-1",
      bodyMarkdown: "reply",
      authorUserId: "user-1"
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const [touchSql, touchParams] = queryMock.mock.calls[1];
    expect(touchSql).toContain("update projects");
    expect(touchSql).toContain("greatest");
    expect(touchSql).toContain("now()");
    expect(touchParams).toEqual(["proj-1"]);
  });
});

describe("createFileMetadata touches project activity", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
  });

  it("calls UPDATE last_activity_at after inserting file metadata", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "file-1", project_id: "proj-1", size_bytes: "1024" }]
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { createFileMetadata } = await import("@/lib/repositories");
    await createFileMetadata({
      projectId: "proj-1",
      uploaderUserId: "user-1",
      filename: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      dropboxFileId: "id:abc",
      dropboxPath: "/Projects/doc.pdf",
      checksum: "deadbeef",
      status: "ready",
      blobUrl: null
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const [touchSql, touchParams] = queryMock.mock.calls[1];
    expect(touchSql).toContain("update projects");
    expect(touchSql).toContain("greatest");
    expect(touchSql).toContain("now()");
    expect(touchParams).toEqual(["proj-1"]);
  });
});

describe("listArchivedProjectsPaginated uses stored last_activity_at", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
  });

  it("does not use correlated subqueries — uses p.last_activity_at directly", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "proj-1",
          name: "Old Site",
          archived: true,
          last_activity_at: "2026-01-01T00:00:00Z",
          total_count: "1"
        }
      ]
    });

    const { listArchivedProjectsPaginated } = await import("@/lib/repositories");
    await listArchivedProjectsPaginated({ search: "", page: 1, limit: 20 });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain("p.last_activity_at");
    expect(sql).not.toContain("select max(t.updated_at)");
    expect(sql).not.toContain("select max(dc.updated_at)");
    expect(sql).not.toContain("select max(f.created_at)");
  });
});
