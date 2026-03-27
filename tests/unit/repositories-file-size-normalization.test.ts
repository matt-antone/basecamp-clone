import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: queryMock
}));

describe("repository file size normalization", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("normalizes bigint string sizes in listFiles", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "file-1", filename: "brief.pdf", size_bytes: "2048" }]
    });

    const { listFiles } = await import("@/lib/repositories");
    const files = await listFiles("project-1");

    expect(files).toEqual([{ id: "file-1", filename: "brief.pdf", size_bytes: 2048 }]);
  });

  it("normalizes attachment sizes returned from getThread", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: "thread-1", project_id: "project-1" }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: "comment-1", project_id: "project-1", thread_id: "thread-1" }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "file-1",
            project_id: "project-1",
            thread_id: "thread-1",
            comment_id: "comment-1",
            filename: "brief.pdf",
            mime_type: "application/pdf",
            size_bytes: "4096",
            created_at: "2026-03-27T00:00:00.000Z"
          }
        ]
      });

    const { getThread } = await import("@/lib/repositories");
    const thread = await getThread("project-1", "thread-1");

    expect(thread?.comments?.[0]?.attachments?.[0]?.size_bytes).toBe(4096);
  });

  it("normalizes getFileById size_bytes values", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: "file-1", project_id: "project-1", size_bytes: "512" }]
    });

    const { getFileById } = await import("@/lib/repositories");
    const file = await getFileById("project-1", "file-1");

    expect(file?.size_bytes).toBe(512);
  });
});
