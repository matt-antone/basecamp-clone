import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const getFileByIdMock = vi.fn();
const upsertThumbnailJobMock = vi.fn();
const fetchMock = vi.fn();
const thumbnailWorkerUrlMock = vi.fn(() => "https://thumbs.example.internal");
const thumbnailWorkerTokenMock = vi.fn(() => "token-123");

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/config", () => ({
  config: {
    thumbnailWorkerUrl: thumbnailWorkerUrlMock,
    thumbnailWorkerToken: thumbnailWorkerTokenMock
  }
}));

vi.mock("@/lib/repositories", () => ({
  getFileById: getFileByIdMock,
  getProject: getProjectMock,
  upsertThumbnailJob: upsertThumbnailJobMock
}));

describe("/projects/[id]/files/[fileId]/thumbnail route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    getFileByIdMock.mockReset();
    upsertThumbnailJobMock.mockReset();
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
    thumbnailWorkerUrlMock.mockReturnValue(null);
    thumbnailWorkerTokenMock.mockReturnValue(null);

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
});
