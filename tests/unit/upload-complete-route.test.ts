import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const getThreadMock = vi.fn();
const getCommentMock = vi.fn();
const createFileMetadataMock = vi.fn();
const assertClientNotArchivedForMutationMock = vi.fn();
const uploadCompleteMock = vi.fn();
const enqueueThumbnailJobAndNotifyBestEffortMock = vi.fn();

vi.mock("@/lib/thumbnail-enqueue-after-save", () => ({
  enqueueThumbnailJobAndNotifyBestEffort: enqueueThumbnailJobAndNotifyBestEffortMock
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  assertClientNotArchivedForMutation: assertClientNotArchivedForMutationMock,
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
    assertClientNotArchivedForMutationMock.mockReset();
    uploadCompleteMock.mockReset();
    enqueueThumbnailJobAndNotifyBestEffortMock.mockReset();
    enqueueThumbnailJobAndNotifyBestEffortMock.mockResolvedValue(undefined);
  });

  it("returns 409 when the client is archived", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      client_id: "11111111-1111-1111-8111-111111111111",
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Site Refresh"
    });
    assertClientNotArchivedForMutationMock.mockRejectedValue(
      new Error("Client archive is in progress. File uploads are temporarily disabled.")
    );

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

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Client archive is in progress. File uploads are temporarily disabled."
    });
    expect(assertClientNotArchivedForMutationMock).toHaveBeenCalledWith(
      "11111111-1111-1111-8111-111111111111",
      expect.objectContaining({
        inProgress: "Client archive is in progress. File uploads are temporarily disabled."
      })
    );
    expect(uploadCompleteMock).not.toHaveBeenCalled();
    expect(createFileMetadataMock).not.toHaveBeenCalled();
    expect(enqueueThumbnailJobAndNotifyBestEffortMock).not.toHaveBeenCalled();
  });

  it("uploads successfully and enqueues thumbnail job best-effort", async () => {
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
    expect(enqueueThumbnailJobAndNotifyBestEffortMock).toHaveBeenCalledTimes(1);
    expect(enqueueThumbnailJobAndNotifyBestEffortMock).toHaveBeenCalledWith({
      projectId: "project-1",
      fileRecord: { id: "file-1" },
      requestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
    });
  });

  it("passes x-request-id to thumbnail enqueue when present", async () => {
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
          "content-type": "application/json",
          "x-request-id": "  upstream-req-99  "
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
    expect(enqueueThumbnailJobAndNotifyBestEffortMock).toHaveBeenCalledWith({
      projectId: "project-1",
      fileRecord: { id: "file-1" },
      requestId: "upstream-req-99"
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

  it("persists threadId and commentId from multipart when provided", async () => {
    const threadUuid = "11111111-1111-1111-8111-111111111111";
    const commentUuid = "22222222-2222-2222-a222-222222222222";
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Site Refresh"
    });
    getThreadMock.mockResolvedValue({ id: threadUuid });
    getCommentMock.mockResolvedValue({ id: commentUuid });
    uploadCompleteMock.mockResolvedValue({
      fileId: "id:abc123",
      path: "/Projects/BRGS/BRGS-0001-Site Refresh/uploads/doc.pdf"
    });
    createFileMetadataMock.mockResolvedValue({ id: "file-1" });

    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const formData = new FormData();
    formData.append("file", new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], "doc.pdf", { type: "application/pdf" }));
    formData.append("sessionId", "session-1");
    formData.append("targetPath", "/Projects/BRGS/BRGS-0001-Site Refresh/uploads/doc.pdf");
    formData.append("threadId", threadUuid);
    formData.append("commentId", commentUuid);

    const response = await POST(
      new Request("http://localhost/projects/project-1/files/upload-complete", {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: formData
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(201);
    expect(getThreadMock).toHaveBeenCalledWith("project-1", threadUuid);
    expect(getCommentMock).toHaveBeenCalledWith("project-1", threadUuid, commentUuid);
    expect(createFileMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: threadUuid,
        commentId: commentUuid
      })
    );
  });

  it("returns 400 when JSON body has commentId without threadId", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Site Refresh"
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
          targetPath: "/Projects/BRGS/BRGS-0001-Site Refresh/uploads/report.pdf",
          commentId: "22222222-2222-2222-a222-222222222222"
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(400);
  });
});
