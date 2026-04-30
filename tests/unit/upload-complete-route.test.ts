import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const assertClientNotArchivedForMutationMock = vi.fn();
const getThreadMock = vi.fn();
const getCommentMock = vi.fn();
const createFileMetadataMock = vi.fn();
const enqueueThumbnailJobAndNotifyBestEffortMock = vi.fn();
const getProjectStorageDirMock = vi.fn();
const getFileMetadataMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/repositories", () => ({
  assertClientNotArchivedForMutation: assertClientNotArchivedForMutationMock,
  createFileMetadata: createFileMetadataMock,
  getComment: getCommentMock,
  getProject: getProjectMock,
  getThread: getThreadMock
}));
vi.mock("@/lib/thumbnail-enqueue-after-save", () => ({
  enqueueThumbnailJobAndNotifyBestEffort: enqueueThumbnailJobAndNotifyBestEffortMock
}));
vi.mock("@/lib/project-storage", () => ({
  getProjectStorageDir: getProjectStorageDirMock
}));
vi.mock("@/lib/storage/dropbox-adapter", () => ({
  DropboxStorageAdapter: class {
    getFileMetadata = getFileMetadataMock;
  }
}));

const PROJECT = { id: "project-1", client_id: "11111111-1111-1111-8111-111111111111" };
const STORAGE_DIR = "/Projects/ACME/ACME-0001-Brief";

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/projects/project-1/files/upload-complete", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

describe("POST /projects/[id]/files/upload-complete", () => {
  beforeEach(() => {
    vi.resetModules();
    [requireUserMock, getProjectMock, assertClientNotArchivedForMutationMock, getThreadMock, getCommentMock,
      createFileMetadataMock, enqueueThumbnailJobAndNotifyBestEffortMock, getProjectStorageDirMock, getFileMetadataMock]
      .forEach((m) => m.mockReset());
    getProjectStorageDirMock.mockReturnValue(STORAGE_DIR);
    requireUserMock.mockResolvedValue({ id: "user-1" });
    getProjectMock.mockResolvedValue(PROJECT);
    assertClientNotArchivedForMutationMock.mockResolvedValue(undefined);
  });

  it("creates the row and returns it on success", async () => {
    getFileMetadataMock.mockResolvedValue({
      fileId: "id:abc", pathDisplay: `${STORAGE_DIR}/uploads/cover.jpg`,
      contentHash: "deadbeef", size: 1234, serverModified: "2026-04-30T17:00:00Z"
    });
    createFileMetadataMock.mockResolvedValue({ id: "row-1", filename: "cover.jpg" });

    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(
      makeRequest(
        { dropboxFileId: "id:abc", requestId: "req-1" },
        { "x-original-mime-type": "image/jpeg" }
      ),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.file.id).toBe("row-1");
    expect(createFileMetadataMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      uploaderUserId: "user-1",
      filename: "cover.jpg",
      mimeType: "image/jpeg",
      dropboxFileId: "id:abc",
      dropboxPath: `${STORAGE_DIR}/uploads/cover.jpg`,
      checksum: "deadbeef",
      sizeBytes: 1234
    }));
    expect(enqueueThumbnailJobAndNotifyBestEffortMock).toHaveBeenCalled();
  });

  it("falls back to application/octet-stream when x-original-mime-type header is missing", async () => {
    getFileMetadataMock.mockResolvedValue({
      fileId: "id:abc", pathDisplay: `${STORAGE_DIR}/uploads/no-mime.bin`,
      contentHash: "h", size: 1, serverModified: "2026-04-30T17:00:00Z"
    });
    createFileMetadataMock.mockResolvedValue({ id: "row-2" });

    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(
      makeRequest({ dropboxFileId: "id:abc", requestId: "r" }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(res.status).toBe(200);
    expect(createFileMetadataMock).toHaveBeenCalledWith(expect.objectContaining({
      mimeType: "application/octet-stream"
    }));
  });

  it("returns 400 when x-original-mime-type contains control characters", async () => {
    getFileMetadataMock.mockResolvedValue({
      fileId: "id:abc", pathDisplay: `${STORAGE_DIR}/uploads/x.jpg`,
      contentHash: "h", size: 1, serverModified: "2026-04-30T17:00:00Z"
    });
    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    // The WHATWG Headers API rejects CRLF values before they reach the handler.
    // Simulate a smuggled value by patching headers.get on an otherwise valid request.
    const req = makeRequest({ dropboxFileId: "id:abc", requestId: "r" });
    const smuggled = "text/html\r\nX-Injected: yes";
    vi.spyOn(req.headers, "get").mockImplementation((name: string) =>
      name.toLowerCase() === "x-original-mime-type" ? smuggled : req.headers.get(name)
    );
    const res = await POST(req, { params: Promise.resolve({ id: "project-1" }) });
    expect(res.status).toBe(400);
    expect(createFileMetadataMock).not.toHaveBeenCalled();
  });

  it("accepts a well-formed mime with a charset parameter", async () => {
    getFileMetadataMock.mockResolvedValue({
      fileId: "id:abc", pathDisplay: `${STORAGE_DIR}/uploads/x.html`,
      contentHash: "h", size: 1, serverModified: "2026-04-30T17:00:00Z"
    });
    createFileMetadataMock.mockResolvedValue({ id: "row-3" });
    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(
      makeRequest(
        { dropboxFileId: "id:abc", requestId: "r" },
        { "x-original-mime-type": "text/html; charset=utf-8" }
      ),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(200);
    expect(createFileMetadataMock).toHaveBeenCalledWith(expect.objectContaining({
      mimeType: "text/html; charset=utf-8"
    }));
  });

  it("returns 403 when path_display starts with the prefix sans trailing slash but lands in a sibling project", async () => {
    getFileMetadataMock.mockResolvedValue({
      fileId: "id:abc",
      pathDisplay: `${STORAGE_DIR}-LEAK/uploads/x.jpg`,
      contentHash: "h", size: 1, serverModified: "2026-04-30T17:00:00Z"
    });
    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(
      makeRequest({ dropboxFileId: "id:abc", requestId: "r" }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(403);
    expect(createFileMetadataMock).not.toHaveBeenCalled();
  });

  it("validates threadId and commentId together for comment attachments", async () => {
    getThreadMock.mockResolvedValue({ id: "thread-1" });
    getCommentMock.mockResolvedValue({ id: "comment-1" });
    getFileMetadataMock.mockResolvedValue({
      fileId: "id:abc", pathDisplay: `${STORAGE_DIR}/uploads/x.jpg`,
      contentHash: "h", size: 1, serverModified: "2026-04-30T17:00:00Z"
    });
    createFileMetadataMock.mockResolvedValue({ id: "row-1" });

    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(
      makeRequest({
        dropboxFileId: "id:abc",
        requestId: "r",
        threadId: "11111111-1111-1111-8111-111111111111",
        commentId: "22222222-2222-2222-8222-222222222222"
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(200);
    expect(createFileMetadataMock).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "11111111-1111-1111-8111-111111111111",
      commentId: "22222222-2222-2222-8222-222222222222"
    }));
  });

  it("returns 400 when commentId is given without threadId", async () => {
    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(
      makeRequest({ dropboxFileId: "id:abc", requestId: "r", commentId: "22222222-2222-2222-8222-222222222222" }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when path_display is outside the project storage prefix", async () => {
    getFileMetadataMock.mockResolvedValue({
      fileId: "id:abc", pathDisplay: "/Projects/OTHER_CLIENT/uploads/leak.jpg",
      contentHash: "h", size: 1, serverModified: "2026-04-30T17:00:00Z"
    });
    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(
      makeRequest({ dropboxFileId: "id:abc", requestId: "r" }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(403);
    expect(createFileMetadataMock).not.toHaveBeenCalled();
  });

  it("maps Dropbox path_not_found to 404", async () => {
    getFileMetadataMock.mockRejectedValue(Object.assign(new Error("path_not_found"), { status: 409 }));
    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(
      makeRequest({ dropboxFileId: "id:nope", requestId: "r" }),
      { params: Promise.resolve({ id: "project-1" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 when requireUser throws", async () => {
    requireUserMock.mockRejectedValue(new Error("Missing auth token"));
    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(makeRequest({ dropboxFileId: "id:abc", requestId: "r" }), { params: Promise.resolve({ id: "project-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 409 when the client is archived", async () => {
    assertClientNotArchivedForMutationMock.mockRejectedValue(new Error("Client is archived. Restore it before uploading files."));
    const { POST } = await import("@/app/projects/[id]/files/upload-complete/route");
    const res = await POST(makeRequest({ dropboxFileId: "id:abc", requestId: "r" }), { params: Promise.resolve({ id: "project-1" }) });
    expect(res.status).toBe(409);
  });
});
