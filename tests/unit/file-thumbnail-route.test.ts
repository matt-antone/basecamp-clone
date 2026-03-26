import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getFileByIdMock = vi.fn();
const createThumbnailMock = vi.fn();
const downloadFileMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  getFileById: getFileByIdMock
}));

vi.mock("@/lib/storage/dropbox-adapter", () => ({
  DropboxStorageAdapter: vi.fn(() => ({
    createThumbnail: createThumbnailMock,
    downloadFile: downloadFileMock
  }))
}));

describe("/projects/[id]/files/[fileId]/thumbnail route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getFileByIdMock.mockReset();
    createThumbnailMock.mockReset();
    downloadFileMock.mockReset();
  });

  it("prefers the Dropbox file id when generating a thumbnail", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      mime_type: "image/png",
      dropbox_file_id: "id:abc123",
      dropbox_path: "/Projects/brgs/example.png"
    });
    createThumbnailMock.mockResolvedValue({
      bytes: Buffer.from("thumb"),
      contentType: "image/jpeg"
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail?size=w640h480", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(200);
    expect(createThumbnailMock).toHaveBeenCalledWith("id:abc123", "w640h480");
    expect(downloadFileMock).not.toHaveBeenCalled();
  });

  it("uses the same Dropbox file id for the download fallback", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      mime_type: "image/png",
      dropbox_file_id: "id:abc123",
      dropbox_path: "/Projects/brgs/example.png"
    });
    createThumbnailMock.mockResolvedValue(null);
    downloadFileMock.mockResolvedValue({
      bytes: Buffer.from("original"),
      contentType: "image/png"
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(200);
    expect(createThumbnailMock).toHaveBeenCalledWith("id:abc123", "w256h256");
    expect(downloadFileMock).toHaveBeenCalledWith("id:abc123");
  });
});
