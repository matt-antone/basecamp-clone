import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const getThreadMock = vi.fn();
const getCommentMock = vi.fn();
const createFileMetadataMock = vi.fn();
const ensureImportedFileThumbnailMock = vi.fn();
const uploadCompleteMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  getThread: getThreadMock,
  getComment: getCommentMock,
  createFileMetadata: createFileMetadataMock
}));

vi.mock("@/lib/import-thumbnail", () => ({
  ensureImportedFileThumbnail: ensureImportedFileThumbnailMock,
  isSupportedImportThumbnailSource: ({ filename, mimeType }: { filename: string; mimeType: string }) =>
    mimeType.toLowerCase().startsWith("image/") || mimeType.toLowerCase() === "application/pdf" || filename.toLowerCase().endsWith(".pdf")
}));

vi.mock("@/lib/storage/dropbox-adapter", () => ({
  DropboxStorageAdapter: class {
    uploadComplete = uploadCompleteMock;
  },
  isTeamSelectUserRequiredError: () => false,
  mapDropboxMetadata: (args: {
    projectId: string;
    uploaderUserId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
    dropboxFileId: string;
    dropboxPath: string;
  }) => ({
    project_id: args.projectId,
    uploader_user_id: args.uploaderUserId,
    filename: args.filename,
    mime_type: args.mimeType,
    size_bytes: args.sizeBytes,
    checksum: args.checksum,
    dropbox_file_id: args.dropboxFileId,
    dropbox_path: args.dropboxPath
  })
}));

describe("POST /projects/[id]/files/upload-complete", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    getThreadMock.mockReset();
    getCommentMock.mockReset();
    createFileMetadataMock.mockReset();
    ensureImportedFileThumbnailMock.mockReset();
    uploadCompleteMock.mockReset();
  });

  it("generates a saved thumbnail for supported uploads", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: "/projects/brgs/BRGS-0001-site-refresh"
    });
    uploadCompleteMock.mockResolvedValue({
      fileId: "id:abc123",
      path: "/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf"
    });
    createFileMetadataMock.mockResolvedValue({ id: "file-1" });
    ensureImportedFileThumbnailMock.mockResolvedValue({
      action: "generated",
      thumbnailPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/.thumbnails/file-1.jpg",
      message: "Thumbnail generated"
    });

    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/files/upload-complete", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          filename: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1234,
          checksum: "abc",
          contentBase64: Buffer.from("pdf").toString("base64"),
          sessionId: "session-1",
          targetPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf"
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(201);
    expect(ensureImportedFileThumbnailMock).toHaveBeenCalledWith({
      projectStorageDir: "/projects/brgs/BRGS-0001-site-refresh",
      projectFileId: "file-1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      dropboxPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf"
    });
  });

  it("keeps upload successful when thumbnail generation fails", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: "/projects/brgs/BRGS-0001-site-refresh"
    });
    uploadCompleteMock.mockResolvedValue({
      fileId: "id:abc123",
      path: "/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf"
    });
    createFileMetadataMock.mockResolvedValue({ id: "file-1" });
    ensureImportedFileThumbnailMock.mockRejectedValue(new Error("pdftoppm missing"));

    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/files/upload-complete", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          filename: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1234,
          checksum: "abc",
          contentBase64: Buffer.from("pdf").toString("base64"),
          sessionId: "session-1",
          targetPath: "/projects/brgs/BRGS-0001-site-refresh/uploads/report.pdf"
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      file: { id: "file-1" }
    });
  });
});
