import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const getFileByIdMock = vi.fn();
const upsertThumbnailJobMock = vi.fn();
const completeThumbnailJobMock = vi.fn();
const failThumbnailJobMock = vi.fn();
const setFileThumbnailUrlMock = vi.fn();
const fetchMock = vi.fn();
const thumbnailWorkerUrlMock = vi.fn(() => "https://thumbs.example.internal");
const thumbnailWorkerTokenMock = vi.fn(() => "token-123");

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/config-core", () => ({
  config: {
    thumbnailWorkerUrl: thumbnailWorkerUrlMock,
    thumbnailWorkerToken: thumbnailWorkerTokenMock
  }
}));

vi.mock("@/lib/repositories", () => ({
  getFileById: getFileByIdMock,
  getProject: getProjectMock,
  upsertThumbnailJob: upsertThumbnailJobMock,
  completeThumbnailJob: completeThumbnailJobMock,
  failThumbnailJob: failThumbnailJobMock,
  setFileThumbnailUrl: setFileThumbnailUrlMock
}));

describe("/projects/[id]/files/[fileId]/thumbnail route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    getFileByIdMock.mockReset();
    upsertThumbnailJobMock.mockReset();
    completeThumbnailJobMock.mockReset();
    failThumbnailJobMock.mockReset();
    setFileThumbnailUrlMock.mockReset();
    fetchMock.mockReset();
    thumbnailWorkerUrlMock.mockReset();
    thumbnailWorkerUrlMock.mockReturnValue("https://thumbs.example.internal");
    thumbnailWorkerTokenMock.mockReset();
    thumbnailWorkerTokenMock.mockReturnValue("token-123");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 200 with url when thumbnail_url is present", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1" });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      thumbnail_url: "https://thumbs.example.internal/thumbnails/file-1.jpg"
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://thumbs.example.internal/thumbnails/file-1.jpg"
    });
  });

  it("queues a thumbnail job and returns 202 when thumbnail_url is absent", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1" });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      filename: "report.pdf",
      mime_type: "application/pdf",
      dropbox_file_id: "id:abc123",
      dropbox_path: "/projects/project-1/report.pdf",
      thumbnail_url: null
    });
    upsertThumbnailJobMock.mockResolvedValue({
      action: "inserted",
      job: { id: "job-1" }
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 202,
      text: vi.fn(async () => "")
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "queued",
      pollAfterMs: 2000
    });
    expect(upsertThumbnailJobMock).toHaveBeenCalledWith({ projectFileId: "file-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://thumbs.example.internal/thumbnails");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer token-123"
    });
  });

  it("returns processing when thumbnail job already exists", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1" });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      filename: "report.pdf",
      mime_type: "application/pdf",
      dropbox_file_id: "id:abc123",
      dropbox_path: "/projects/project-1/report.pdf",
      thumbnail_url: null
    });
    upsertThumbnailJobMock.mockResolvedValue({
      action: "deduped",
      job: { id: "job-1" }
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 202,
      text: vi.fn(async () => "")
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "processing",
      pollAfterMs: 2000
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 202 when worker notify returns a non-2xx response", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1" });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      filename: "report.pdf",
      mime_type: "application/pdf",
      dropbox_file_id: "id:abc123",
      dropbox_path: "/projects/project-1/report.pdf",
      thumbnail_url: null
    });
    upsertThumbnailJobMock.mockResolvedValue({
      action: "inserted",
      job: { id: "job-1" }
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn(async () => "queue unavailable")
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "queued",
      pollAfterMs: 2000
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 202 and skips worker notify when worker config is missing", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1" });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      filename: "report.pdf",
      mime_type: "application/pdf",
      dropbox_file_id: "id:abc123",
      dropbox_path: "/projects/project-1/report.pdf",
      thumbnail_url: null
    });
    upsertThumbnailJobMock.mockResolvedValue({
      action: "inserted",
      job: { id: "job-1" }
    });
    thumbnailWorkerUrlMock.mockReturnValue(null as unknown as string);
    thumbnailWorkerTokenMock.mockReturnValue(null as unknown as string);

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "queued",
      pollAfterMs: 2000
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 when job is permanently failed", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1" });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      filename: "missing.pdf",
      mime_type: "application/pdf",
      dropbox_file_id: "id:gone",
      dropbox_path: "/projects/project-1/missing.pdf",
      thumbnail_url: null
    });
    upsertThumbnailJobMock.mockResolvedValue({
      action: "permanent_failure",
      job: { id: "job-1", last_error: "path/not_found" }
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /projects/[id]/files/[fileId]/thumbnail (worker callback)", () => {
  beforeEach(() => {
    completeThumbnailJobMock.mockReset();
    failThumbnailJobMock.mockReset();
    setFileThumbnailUrlMock.mockReset();
    thumbnailWorkerTokenMock.mockReset();
    thumbnailWorkerTokenMock.mockReturnValue("token-123");
    completeThumbnailJobMock.mockResolvedValue(undefined);
    failThumbnailJobMock.mockResolvedValue(undefined);
    setFileThumbnailUrlMock.mockResolvedValue(null);
  });

  it("accepts succeeded callback and updates thumbnail url", async () => {
    const { POST } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        method: "POST",
        headers: { authorization: "Bearer token-123", "content-type": "application/json" },
        body: JSON.stringify({ action: "succeeded", thumbnailUrl: "https://example.com/thumb.jpg" })
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(200);
    expect(setFileThumbnailUrlMock).toHaveBeenCalledWith({
      projectId: "project-1",
      fileId: "file-1",
      thumbnailUrl: "https://example.com/thumb.jpg"
    });
    expect(completeThumbnailJobMock).toHaveBeenCalledWith({ projectFileId: "file-1" });
  });

  it("accepts transient failed callback", async () => {
    const { POST } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        method: "POST",
        headers: { authorization: "Bearer token-123", "content-type": "application/json" },
        body: JSON.stringify({ action: "failed", error: "timeout after 30s", permanent: false })
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(200);
    expect(failThumbnailJobMock).toHaveBeenCalledWith({
      projectFileId: "file-1",
      error: "timeout after 30s",
      permanent: false
    });
  });

  it("accepts permanent failed callback (file not in Dropbox)", async () => {
    const { POST } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        method: "POST",
        headers: { authorization: "Bearer token-123", "content-type": "application/json" },
        body: JSON.stringify({ action: "failed", error: "path/not_found", permanent: true })
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(200);
    expect(failThumbnailJobMock).toHaveBeenCalledWith({
      projectFileId: "file-1",
      error: "path/not_found",
      permanent: true
    });
  });

  it("rejects callback with wrong token", async () => {
    const { POST } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        method: "POST",
        headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
        body: JSON.stringify({ action: "succeeded", thumbnailUrl: "https://example.com/thumb.jpg" })
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(401);
    expect(setFileThumbnailUrlMock).not.toHaveBeenCalled();
  });

  it("rejects callback with unknown action", async () => {
    const { POST } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        method: "POST",
        headers: { authorization: "Bearer token-123", "content-type": "application/json" },
        body: JSON.stringify({ action: "mystery" })
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(400);
  });

  it("rejects succeeded callback missing thumbnailUrl", async () => {
    const { POST } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        method: "POST",
        headers: { authorization: "Bearer token-123", "content-type": "application/json" },
        body: JSON.stringify({ action: "succeeded" })
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(400);
    expect(setFileThumbnailUrlMock).not.toHaveBeenCalled();
  });
});
