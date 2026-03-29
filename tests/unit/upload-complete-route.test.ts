import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const getThreadMock = vi.fn();
const getCommentMock = vi.fn();
const createFileMetadataMock = vi.fn();
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
    uploadCompleteMock.mockReset();
  });

  it("uploads successfully without calling thumbnail generation", async () => {
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

  it("keeps upload successful with no thumbnail side effects", async () => {
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
    expect(createFileMetadataMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      file: { id: "file-1" }
    });
  });
});
