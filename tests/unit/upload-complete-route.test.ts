import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const getThreadMock = vi.fn();
const getCommentMock = vi.fn();
const createFileMetadataMock = vi.fn();
const markFileTransferInProgressMock = vi.fn();
const markFileTransferFailedMock = vi.fn();
const finalizeFileMetadataAfterTransferMock = vi.fn();
const assertClientNotArchivedForMutationMock = vi.fn();
const uploadCompleteMock = vi.fn();
const enqueueThumbnailJobAndNotifyBestEffortMock = vi.fn();
const delMock = vi.fn();

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
  createFileMetadata: createFileMetadataMock,
  markFileTransferInProgress: markFileTransferInProgressMock,
  markFileTransferFailed: markFileTransferFailedMock,
  finalizeFileMetadataAfterTransfer: finalizeFileMetadataAfterTransferMock
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
  }
}));

vi.mock("@vercel/blob", () => ({
  del: delMock
}));

// Capture after() callbacks so tests can await them explicitly.
let pendingAfterCallback: (() => Promise<void>) | null = null;

async function flushAfter() {
  if (pendingAfterCallback) {
    const cb = pendingAfterCallback;
    pendingAfterCallback = null;
    await cb();
  }
}

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (fn: () => Promise<void>) => {
      pendingAfterCallback = fn;
    }
  };
});

const BLOB_URL = "https://blob.vercel-storage.com/test/report.pdf";

function makeFetchMock(content = Buffer.from("pdf")) {
  return vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(content.buffer)
  });
}

describe("POST /projects/[id]/files/upload-complete", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    pendingAfterCallback = null;
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    getThreadMock.mockReset();
    getCommentMock.mockReset();
    createFileMetadataMock.mockReset();
    markFileTransferInProgressMock.mockReset();
    markFileTransferFailedMock.mockReset();
    finalizeFileMetadataAfterTransferMock.mockReset();
    assertClientNotArchivedForMutationMock.mockReset();
    uploadCompleteMock.mockReset();
    enqueueThumbnailJobAndNotifyBestEffortMock.mockReset();
    delMock.mockReset();

    enqueueThumbnailJobAndNotifyBestEffortMock.mockResolvedValue(undefined);
    markFileTransferInProgressMock.mockResolvedValue(undefined);
    markFileTransferFailedMock.mockResolvedValue(undefined);
    finalizeFileMetadataAfterTransferMock.mockResolvedValue(undefined);
    delMock.mockResolvedValue(undefined);
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
          blobUrl: BLOB_URL,
          filename: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1234
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
    createFileMetadataMock.mockResolvedValue({ id: "file-1" });
    uploadCompleteMock.mockResolvedValue({
      fileId: "id:abc123",
      path: "/Projects/BRGS/BRGS-0001-Site Refresh/uploads/report.pdf"
    });
    vi.stubGlobal("fetch", makeFetchMock());

    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/files/upload-complete", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          blobUrl: BLOB_URL,
          filename: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1234
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    await flushAfter();

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      file: { id: "file-1" }
    });
    expect(enqueueThumbnailJobAndNotifyBestEffortMock).toHaveBeenCalledTimes(1);
    expect(enqueueThumbnailJobAndNotifyBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        requestId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        )
      })
    );
    expect(delMock).toHaveBeenCalledWith(BLOB_URL);
  });

  it("passes x-request-id to thumbnail enqueue when present", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Site Refresh"
    });
    createFileMetadataMock.mockResolvedValue({ id: "file-1" });
    uploadCompleteMock.mockResolvedValue({
      fileId: "id:abc123",
      path: "/Projects/BRGS/BRGS-0001-Site Refresh/uploads/report.pdf"
    });
    vi.stubGlobal("fetch", makeFetchMock());

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
          blobUrl: BLOB_URL,
          filename: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1234
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    await flushAfter();

    expect(response.status).toBe(202);
    expect(enqueueThumbnailJobAndNotifyBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        requestId: "upstream-req-99"
      })
    );
  });

  it("rejects multipart form data with 400", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Site Refresh"
    });

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

    expect(response.status).toBe(400);
    expect(uploadCompleteMock).not.toHaveBeenCalled();
  });

  it("marks transfer failed and deletes blob when Dropbox upload rejects", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Site Refresh"
    });
    createFileMetadataMock.mockResolvedValue({ id: "file-1" });
    vi.stubGlobal("fetch", makeFetchMock());
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
          blobUrl: BLOB_URL,
          filename: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1234
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    await flushAfter();

    // Dropbox error is caught in after(); row marked failed, blob deleted.
    // The synchronous path still returns 202 — transfer error surfaced via status polling.
    expect(response.status).toBe(202);
    expect(markFileTransferFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "file-1", error: "invalid_access_token/.." })
    );
    expect(delMock).toHaveBeenCalledWith(BLOB_URL);
  });

  it("persists threadId and commentId from JSON payload when provided", async () => {
    const threadUuid = "11111111-1111-1111-8111-111111111111";
    const commentUuid = "22222222-2222-2222-a222-222222222222";
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: "/Projects/BRGS/BRGS-0001-Site Refresh"
    });
    getThreadMock.mockResolvedValue({ id: threadUuid });
    getCommentMock.mockResolvedValue({ id: commentUuid });
    createFileMetadataMock.mockResolvedValue({ id: "file-1" });
    uploadCompleteMock.mockResolvedValue({
      fileId: "id:abc123",
      path: "/Projects/BRGS/BRGS-0001-Site Refresh/uploads/doc.pdf"
    });
    vi.stubGlobal("fetch", makeFetchMock(Buffer.from("pdf")));

    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/files/upload-complete", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          blobUrl: BLOB_URL,
          filename: "doc.pdf",
          mimeType: "application/pdf",
          sizeBytes: 4,
          threadId: threadUuid,
          commentId: commentUuid
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(202);
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
          blobUrl: BLOB_URL,
          filename: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1234,
          commentId: "22222222-2222-2222-a222-222222222222"
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(400);
  });
});
