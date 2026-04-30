import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: queryMock
}));

describe("createFileMetadata (direct-to-Dropbox)", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("inserts row without status/blob_url and returns the new row", async () => {
    // First call: main insert. touchProjectActivity calls query internally too.
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "row-1",
            project_id: "p",
            uploader_user_id: "u",
            filename: "x.jpg",
            mime_type: "image/jpeg",
            size_bytes: 100,
            dropbox_file_id: "id:abc",
            dropbox_path: "/Projects/.../x.jpg",
            checksum: "deadbeef",
            created_at: "2026-04-30T17:00:00Z"
          }
        ]
      })
      // Second call: touchProjectActivity -> update projects set updated_at
      .mockResolvedValueOnce({ rows: [] });

    const { createFileMetadata } = await import("@/lib/repositories");
    const row = await createFileMetadata({
      projectId: "p",
      uploaderUserId: "u",
      filename: "x.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 100,
      dropboxFileId: "id:abc",
      dropboxPath: "/Projects/.../x.jpg",
      checksum: "deadbeef"
    });

    expect(row?.id).toBe("row-1");
    const sql: string = queryMock.mock.calls[0]?.[0] ?? "";
    expect(sql).not.toMatch(/\bstatus\b|\bblob_url\b|\btransfer_error\b/);
  });

  it("accepts optional fields without errors", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "row-2",
            project_id: "proj",
            uploader_user_id: "user",
            filename: "doc.pdf",
            mime_type: "application/pdf",
            size_bytes: 2048,
            dropbox_file_id: "id:xyz",
            dropbox_path: "/Projects/.../doc.pdf",
            checksum: "cafebabe",
            created_at: "2026-04-30T18:00:00Z"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const { createFileMetadata } = await import("@/lib/repositories");
    const row = await createFileMetadata({
      projectId: "proj",
      uploaderUserId: "user",
      filename: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      dropboxFileId: "id:xyz",
      dropboxPath: "/Projects/.../doc.pdf",
      checksum: "cafebabe",
      threadId: "t1",
      commentId: "c1",
      thumbnailUrl: null,
      bcAttachmentId: null,
      sourceCreatedAt: new Date("2026-01-01T00:00:00Z")
    });

    expect(row?.id).toBe("row-2");
  });
});
