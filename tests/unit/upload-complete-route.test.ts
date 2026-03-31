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
  getDropboxErrorSummary: (error: unknown) => {
    if (typeof error === "object" && error !== null) {
      const obj = error as { message?: unknown; error?: { error_summary?: unknown } };
      if (typeof obj.error?.error_summary === "string") {
        return obj.error.error_summary;
      }
      if (typeof obj.message === "string") {
        return obj.message;
      }
    }
    return String(error);
  },
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
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Site Refresh"
    });
    uploadCompleteMock.mockResolvedValue({
      fileId: "id:abc123",
      path: "/Projects/BRGS/BRGS-0001-Site Refresh/uploads/report.pdf"
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
          targetPath: "/Projects/BRGS/BRGS-0001-Site Refresh/uploads/report.pdf"
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
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Site Refresh"
    });
    uploadCompleteMock.mockResolvedValue({
      fileId: "id:abc123",
      path: "/Projects/BRGS/BRGS-0001-Site Refresh/uploads/report.pdf"
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
          targetPath: "/Projects/BRGS/BRGS-0001-Site Refresh/uploads/report.pdf"
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

  it("uploads multipart image payloads from the browser flow", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Site Refresh"
    });
    uploadCompleteMock.mockResolvedValue({
      fileId: "id:img123",
      path: "/Projects/BRGS/BRGS-0001-Site Refresh/uploads/photo.png"
    });
    createFileMetadataMock.mockResolvedValue({ id: "file-1" });

    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const formData = new FormData();
    formData.append(
      "file",
      new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" })
    );
    formData.append("sessionId", "session-1");
    formData.append("targetPath", "/Projects/BRGS/BRGS-0001-Site Refresh/uploads/photo.png");

    const response = await POST(
      new Request("http://localhost/projects/project-1/files/upload-complete", {
        method: "POST",
        headers: {
          authorization: "Bearer token"
        },
        body: formData
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(201);
    expect(uploadCompleteMock).toHaveBeenCalledTimes(1);
    const call = uploadCompleteMock.mock.calls[0]?.[0] as {
      filename: string;
      mimeType: string;
      content: Buffer;
    };
    expect(call.filename).toBe("photo.png");
    expect(call.mimeType).toBe("image/png");
    expect(Buffer.isBuffer(call.content)).toBe(true);
    expect(call.content.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
  });

  it("returns 401 when Dropbox auth errors are returned as non-Error objects", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Site Refresh"
    });
    uploadCompleteMock.mockRejectedValue({
      error: {
        error_summary: "invalid_access_token/.."
      }
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
          targetPath: "/Projects/BRGS/BRGS-0001-Site Refresh/uploads/report.pdf"
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("invalid_access_token")
    });
  });
});
