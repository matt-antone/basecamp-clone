import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: queryMock
}));

describe("project file metadata schema compatibility", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("retries without attachment columns for older project_files schemas", async () => {
    queryMock
      .mockRejectedValueOnce({
        code: "42703",
        message: 'column "thumbnail_url" of relation "project_files" does not exist'
      })
      .mockRejectedValueOnce({
        code: "42703",
        message: 'column "thread_id" of relation "project_files" does not exist'
      })
      .mockResolvedValueOnce({ rows: [{ id: "file-1" }] });

    const { createFileMetadata } = await import("@/lib/repositories");
    const created = await createFileMetadata({
      projectId: "project-1",
      uploaderUserId: "user-1",
      filename: "brief.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      dropboxFileId: "dbx:1",
      dropboxPath: "/Projects/BRGS/brief.pdf",
      checksum: "sha256"
    });

    expect(created).toEqual({ id: "file-1" });
    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(queryMock.mock.calls[2]?.[0]).not.toContain("thread_id");
    expect(queryMock.mock.calls[2]?.[0]).not.toContain("comment_id");
    expect(queryMock.mock.calls[2]?.[0]).not.toContain("thumbnail_url");
  });

  it("throws a migration error when comment attachments need missing columns", async () => {
    queryMock
      .mockRejectedValueOnce({
        code: "42703",
        message: 'column "thumbnail_url" of relation "project_files" does not exist'
      })
      .mockRejectedValueOnce({
        code: "42703",
        message: 'column "thread_id" of relation "project_files" does not exist'
      });

    const { createFileMetadata } = await import("@/lib/repositories");

    await expect(
      createFileMetadata({
        projectId: "project-1",
        uploaderUserId: "user-1",
        filename: "brief.pdf",
        mimeType: "application/pdf",
        sizeBytes: 42,
        dropboxFileId: "dbx:1",
        dropboxPath: "/Projects/BRGS/brief.pdf",
        checksum: "sha256",
        threadId: "11111111-1111-1111-8111-111111111111",
        commentId: "22222222-2222-2222-a222-222222222222"
      })
    ).rejects.toThrow("Comment attachments require database migration 0007_comment_attachments.sql");
  });
});
