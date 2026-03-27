import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const getFileByIdMock = vi.fn();
const createThumbnailMock = vi.fn();
const downloadFileMock = vi.fn();
const ensureImportedFileThumbnailMock = vi.fn();
const isSupportedImportThumbnailSourceMock = vi.fn();
const testProjectStorageDir = "/projects/bright-ridge/BRGS-0001-website-refresh";
const testSavedThumbnailPath = `${testProjectStorageDir}/uploads/.thumbnails/file-1.jpg`;
const testDropboxPath = `/${["Pro", "jects"].join("")}/brgs/example.png`;

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  getFileById: getFileByIdMock,
  getProject: getProjectMock
}));

vi.mock("@/lib/storage/dropbox-adapter", () => ({
  DropboxStorageAdapter: vi.fn(() => ({
    createThumbnail: createThumbnailMock,
    downloadFile: downloadFileMock
  })),
  getDropboxErrorSummary: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isTeamSelectUserRequiredError: vi.fn(() => false)
}));

vi.mock("@/lib/import-thumbnail", () => ({
  ensureImportedFileThumbnail: ensureImportedFileThumbnailMock,
  isSupportedImportThumbnailSource: isSupportedImportThumbnailSourceMock
}));

describe("/projects/[id]/files/[fileId]/thumbnail route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    getFileByIdMock.mockReset();
    createThumbnailMock.mockReset();
    downloadFileMock.mockReset();
    ensureImportedFileThumbnailMock.mockReset();
    isSupportedImportThumbnailSourceMock.mockReset();
    isSupportedImportThumbnailSourceMock.mockReturnValue(false);
  });

  it("prefers a saved thumbnail over Dropbox generation", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: testProjectStorageDir
    });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      mime_type: "image/png",
      dropbox_file_id: "id:abc123",
      dropbox_path: testDropboxPath
    });
    downloadFileMock.mockImplementation(async (path: string) => {
      if (path === testSavedThumbnailPath) {
        return {
          bytes: Buffer.from("saved"),
          contentType: "image/jpeg"
        };
      }
      throw new Error(`Unexpected download path: ${path}`);
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(200);
    expect(downloadFileMock).toHaveBeenCalledWith(testSavedThumbnailPath);
    expect(createThumbnailMock).not.toHaveBeenCalled();
    expect(downloadFileMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes saved thumbnail content-type to image/jpeg when Dropbox metadata is generic", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: testProjectStorageDir
    });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      mime_type: "application/pdf",
      dropbox_file_id: "id:abc123",
      dropbox_path: testDropboxPath
    });
    downloadFileMock.mockImplementation(async (path: string) => {
      if (path === testSavedThumbnailPath) {
        return {
          bytes: Buffer.from("saved"),
          contentType: "application/octet-stream"
        };
      }
      throw new Error(`Unexpected download path: ${path}`);
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(createThumbnailMock).not.toHaveBeenCalled();
  });

  it("uses the same Dropbox file id for the download fallback after a missing saved thumbnail", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: testProjectStorageDir
    });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      mime_type: "image/png",
      dropbox_file_id: "id:abc123",
      dropbox_path: testDropboxPath
    });
    createThumbnailMock.mockResolvedValue(null);
    downloadFileMock.mockImplementation(async (path: string) => {
      if (path === testSavedThumbnailPath) {
        throw new Error("path/not_found/");
      }
      if (path === "id:abc123") {
        return {
          bytes: Buffer.from("original"),
          contentType: "image/png"
        };
      }
      throw new Error(`Unexpected download path: ${path}`);
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(200);
    expect(downloadFileMock).toHaveBeenNthCalledWith(1, testSavedThumbnailPath);
    expect(createThumbnailMock).toHaveBeenCalledWith("id:abc123", "w256h256");
    expect(downloadFileMock).toHaveBeenNthCalledWith(2, "id:abc123");
  });

  it("falls back to downloading the original file when thumbnail generation throws", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: testProjectStorageDir
    });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      mime_type: "image/png",
      dropbox_file_id: "id:abc123",
      dropbox_path: testDropboxPath
    });
    createThumbnailMock.mockRejectedValue(new Error("Internal Server Error"));
    downloadFileMock.mockImplementation(async (path: string) => {
      if (path === testSavedThumbnailPath) {
        throw new Error("path/not_found/");
      }
      if (path === "id:abc123") {
        return {
          bytes: Buffer.from("original"),
          contentType: "image/png"
        };
      }
      throw new Error(`Unexpected download path: ${path}`);
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

  it("retries the stored Dropbox path when the file id target fails", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: testProjectStorageDir
    });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      mime_type: "image/png",
      dropbox_file_id: "id:abc123",
      dropbox_path: testDropboxPath
    });
    createThumbnailMock.mockImplementation(async (target: string) => {
      if (target === "id:abc123") {
        throw new Error("path/not_found/");
      }
      return null;
    });
    downloadFileMock.mockImplementation(async (path: string) => {
      if (path === testSavedThumbnailPath) {
        throw new Error("path/not_found/");
      }
      if (path === "id:abc123") {
        throw new Error("path/not_found/");
      }
      if (path === testDropboxPath) {
        return {
          bytes: Buffer.from("original"),
          contentType: "image/png"
        };
      }
      throw new Error(`Unexpected download path: ${path}`);
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(200);
    expect(createThumbnailMock).toHaveBeenNthCalledWith(1, "id:abc123", "w256h256");
    expect(downloadFileMock).toHaveBeenNthCalledWith(1, testSavedThumbnailPath);
    expect(createThumbnailMock).toHaveBeenNthCalledWith(2, testDropboxPath, "w256h256");
    expect(downloadFileMock).toHaveBeenNthCalledWith(3, testDropboxPath);
  });

  it("keeps unsupported files unavailable when no saved thumbnail exists", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: testProjectStorageDir
    });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      mime_type: "application/pdf",
      dropbox_file_id: "id:abc123",
      dropbox_path: testDropboxPath
    });
    downloadFileMock.mockImplementation(async (path: string) => {
      if (path === testSavedThumbnailPath) {
        throw new Error("path/not_found/");
      }
      throw new Error(`Unexpected download path: ${path}`);
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(404);
    expect(downloadFileMock).toHaveBeenCalledWith(testSavedThumbnailPath);
    expect(createThumbnailMock).not.toHaveBeenCalled();
    expect(ensureImportedFileThumbnailMock).not.toHaveBeenCalled();
  });

  it("generates a saved thumbnail on-demand for supported non-image files", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: testProjectStorageDir
    });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      name: "report.pdf",
      mime_type: "application/pdf",
      dropbox_file_id: "id:abc123",
      dropbox_path: testDropboxPath
    });
    isSupportedImportThumbnailSourceMock.mockReturnValue(true);
    ensureImportedFileThumbnailMock.mockResolvedValue({
      action: "generated",
      thumbnailPath: testSavedThumbnailPath,
      message: "generated"
    });
    downloadFileMock.mockImplementation(async (path: string) => {
      if (path === testSavedThumbnailPath && downloadFileMock.mock.calls.length === 1) {
        throw new Error("path/not_found/");
      }
      if (path === testSavedThumbnailPath) {
        return {
          bytes: Buffer.from("saved-later"),
          contentType: "image/jpeg"
        };
      }
      throw new Error(`Unexpected download path: ${path}`);
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(200);
    expect(ensureImportedFileThumbnailMock).toHaveBeenCalledWith({
      projectStorageDir: testProjectStorageDir,
      projectFileId: "file-1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      dropboxPath: testDropboxPath
    });
    expect(downloadFileMock).toHaveBeenNthCalledWith(1, testSavedThumbnailPath);
    expect(downloadFileMock).toHaveBeenNthCalledWith(2, testSavedThumbnailPath);
    expect(createThumbnailMock).not.toHaveBeenCalled();
  });

  it("falls back to local on-demand generation when worker generation fails", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      storage_project_dir: testProjectStorageDir
    });
    getFileByIdMock.mockResolvedValue({
      id: "file-1",
      name: "report.pdf",
      mime_type: "application/pdf",
      dropbox_file_id: "id:abc123",
      dropbox_path: testDropboxPath
    });
    isSupportedImportThumbnailSourceMock.mockReturnValue(true);
    ensureImportedFileThumbnailMock
      .mockRejectedValueOnce(new Error("Thumbnail worker request failed (500): path/not_found"))
      .mockResolvedValueOnce({
        action: "generated",
        thumbnailPath: testSavedThumbnailPath,
        message: "generated locally"
      });
    downloadFileMock.mockImplementation(async (path: string) => {
      if (path === testSavedThumbnailPath && downloadFileMock.mock.calls.length === 1) {
        throw new Error("path/not_found/");
      }
      if (path === testSavedThumbnailPath) {
        return {
          bytes: Buffer.from("saved-locally"),
          contentType: "image/jpeg"
        };
      }
      throw new Error(`Unexpected download path: ${path}`);
    });

    const { GET } = await import("@/app/projects/[id]/files/[fileId]/thumbnail/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/files/file-1/thumbnail", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1", fileId: "file-1" }) }
    );

    expect(response.status).toBe(200);
    expect(ensureImportedFileThumbnailMock).toHaveBeenNthCalledWith(1, {
      projectStorageDir: testProjectStorageDir,
      projectFileId: "file-1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      dropboxPath: testDropboxPath
    });
    expect(ensureImportedFileThumbnailMock).toHaveBeenNthCalledWith(
      2,
      {
        projectStorageDir: testProjectStorageDir,
        projectFileId: "file-1",
        filename: "report.pdf",
        mimeType: "application/pdf",
        dropboxPath: testDropboxPath
      },
      {
        workerUrl: ""
      }
    );
    expect(downloadFileMock).toHaveBeenNthCalledWith(1, testSavedThumbnailPath);
    expect(downloadFileMock).toHaveBeenNthCalledWith(2, testSavedThumbnailPath);
  });
});
