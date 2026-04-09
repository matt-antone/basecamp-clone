// tests/unit/mcp-dropbox.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const envMap = new Map<string, string>();
vi.stubGlobal("Deno", {
  env: {
    get: (key: string) => envMap.get(key) ?? undefined,
  },
});

// Mock the Dropbox SDK
const mockFilesDownload = vi.fn();
const mockFilesGetTemporaryLink = vi.fn();
const mockUsersGetCurrentAccount = vi.fn();
const MockDropbox = vi.fn().mockImplementation(() => ({
  filesDownload: mockFilesDownload,
  filesGetTemporaryLink: mockFilesGetTemporaryLink,
  usersGetCurrentAccount: mockUsersGetCurrentAccount,
}));

vi.mock("dropbox", () => ({ Dropbox: MockDropbox }));

const dropbox = await import("../../supabase/functions/basecamp-mcp/dropbox.ts");

beforeEach(() => {
  envMap.clear();
  vi.clearAllMocks();
  dropbox._resetTokenCache();
});

function setDropboxEnv() {
  envMap.set("DROPBOX_APP_KEY", "fake-client-id");
  envMap.set("DROPBOX_APP_SECRET", "fake-secret");
  envMap.set("DROPBOX_REFRESH_TOKEN", "fake-refresh-token");
}

function setupTeamAccount() {
  mockUsersGetCurrentAccount.mockResolvedValue({
    result: {
      root_info: {
        root_namespace_id: "team-root-456",
        home_namespace_id: "home-123",
      },
    },
  });
}

function setupPersonalAccount() {
  mockUsersGetCurrentAccount.mockResolvedValue({
    result: {
      root_info: {
        root_namespace_id: "ns-123",
        home_namespace_id: "ns-123",
      },
    },
  });
}

describe("getTemporaryLink", () => {
  it("returns temporary link URL", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    mockFilesGetTemporaryLink.mockResolvedValue({
      result: { link: "https://dl.dropbox.com/temp-link" },
    });

    const link = await dropbox.getTemporaryLink("id:abc123");

    expect(link).toBe("https://dl.dropbox.com/temp-link");
    expect(mockFilesGetTemporaryLink).toHaveBeenCalledWith({ path: "id:abc123" });
  });

  it("throws 'File not found in storage' on 409 not_found", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    mockFilesGetTemporaryLink.mockRejectedValue({
      status: 409,
      error: { error_summary: "path/not_found/" },
    });

    await expect(dropbox.getTemporaryLink("/missing")).rejects.toThrow("File not found in storage");
  });

  it("throws 'Storage rate limited' on 429", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    mockFilesGetTemporaryLink.mockRejectedValue({
      status: 429,
      error: { error_summary: "too_many_requests/" },
    });

    await expect(dropbox.getTemporaryLink("/file")).rejects.toThrow("Storage rate limited");
  });
});

describe("downloadFile", () => {
  it("returns bytes and content type from fileBinary", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    const fileBytes = new TextEncoder().encode("hello world");
    mockFilesDownload.mockResolvedValue({
      result: {
        fileBinary: fileBytes.buffer,
        content_type: "text/plain",
      },
    });

    const result = await dropbox.downloadFile("id:abc123");

    expect(result.contentType).toBe("text/plain");
    expect(new TextDecoder().decode(result.bytes)).toBe("hello world");
    expect(mockFilesDownload).toHaveBeenCalledWith({ path: "id:abc123" });
  });

  it("returns bytes from fileBlob (Blob-like)", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    const fileBytes = new TextEncoder().encode("blob data");
    mockFilesDownload.mockResolvedValue({
      result: {
        fileBlob: {
          arrayBuffer: () => Promise.resolve(fileBytes.buffer),
        },
        content_type: "image/png",
      },
    });

    const result = await dropbox.downloadFile("id:xyz");

    expect(result.contentType).toBe("image/png");
    expect(new TextDecoder().decode(result.bytes)).toBe("blob data");
  });

  it("throws 'File not found in storage' on 409 not_found", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    mockFilesDownload.mockRejectedValue({
      status: 409,
      error: { error_summary: "path/not_found/" },
    });

    await expect(dropbox.downloadFile("/missing")).rejects.toThrow("File not found in storage");
  });

  it("defaults content type to application/octet-stream", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    mockFilesDownload.mockResolvedValue({
      result: {
        fileBinary: new ArrayBuffer(0),
      },
    });

    const result = await dropbox.downloadFile("id:xyz");
    expect(result.contentType).toBe("application/octet-stream");
  });

  it("throws StorageError when no binary payload", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    mockFilesDownload.mockResolvedValue({ result: {} });

    await expect(dropbox.downloadFile("id:xyz")).rejects.toThrow("Storage error");
  });
});

describe("team account path root", () => {
  it("creates second Dropbox client with pathRoot for team accounts", async () => {
    setDropboxEnv();
    setupTeamAccount();
    mockFilesGetTemporaryLink.mockResolvedValue({
      result: { link: "https://dl.dropbox.com/link" },
    });

    await dropbox.getTemporaryLink("/file.png");

    // First call: base client (no pathRoot), Second call: with pathRoot
    expect(MockDropbox).toHaveBeenCalledTimes(2);
    const secondCallArgs = MockDropbox.mock.calls[1][0];
    expect(secondCallArgs.pathRoot).toBe(
      JSON.stringify({ ".tag": "root", root: "team-root-456" })
    );
  });

  it("uses base client for personal accounts (no pathRoot)", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    mockFilesGetTemporaryLink.mockResolvedValue({
      result: { link: "https://dl.dropbox.com/link" },
    });

    await dropbox.getTemporaryLink("/file.png");

    // Only one Dropbox client created (no pathRoot needed)
    expect(MockDropbox).toHaveBeenCalledTimes(1);
  });

  it("caches client across calls", async () => {
    setDropboxEnv();
    setupTeamAccount();
    mockFilesGetTemporaryLink.mockResolvedValue({
      result: { link: "https://dl.dropbox.com/link" },
    });

    await dropbox.getTemporaryLink("/file1.png");
    await dropbox.getTemporaryLink("/file2.png");

    // Account lookup happens once, not twice
    expect(mockUsersGetCurrentAccount).toHaveBeenCalledTimes(1);
  });

  it("falls back to base client when get_current_account fails", async () => {
    setDropboxEnv();
    mockUsersGetCurrentAccount.mockRejectedValue(new Error("network error"));
    mockFilesGetTemporaryLink.mockResolvedValue({
      result: { link: "https://dl.dropbox.com/link" },
    });

    const link = await dropbox.getTemporaryLink("/file.png");

    expect(link).toBe("https://dl.dropbox.com/link");
    // Only base client, no second client created
    expect(MockDropbox).toHaveBeenCalledTimes(1);
  });
});

describe("team headers", () => {
  it("passes selectUser to Dropbox client", async () => {
    setDropboxEnv();
    envMap.set("DROPBOX_SELECT_USER", "dbmid:user123");
    setupPersonalAccount();
    mockFilesGetTemporaryLink.mockResolvedValue({
      result: { link: "https://dl.dropbox.com/link" },
    });

    await dropbox.getTemporaryLink("/file");

    expect(MockDropbox.mock.calls[0][0].selectUser).toBe("dbmid:user123");
  });

  it("passes selectAdmin to Dropbox client", async () => {
    setDropboxEnv();
    envMap.set("DROPBOX_SELECT_ADMIN", "dbmid:admin456");
    setupPersonalAccount();
    mockFilesDownload.mockResolvedValue({
      result: { fileBinary: new ArrayBuffer(0) },
    });

    await dropbox.downloadFile("/file");

    expect(MockDropbox.mock.calls[0][0].selectAdmin).toBe("dbmid:admin456");
  });
});

describe("config errors", () => {
  it("throws DropboxConfigError when credentials are missing", async () => {
    await expect(dropbox.getTemporaryLink("/file")).rejects.toThrow(
      "Dropbox credentials missing"
    );
  });

  it("throws DropboxAuthError on 401", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    mockFilesDownload.mockRejectedValue({
      status: 401,
      error: { error_summary: "invalid_access_token/" },
    });

    await expect(dropbox.downloadFile("/file")).rejects.toThrow("Dropbox authentication failed");
  });
});

describe("secret safety", () => {
  it("error messages never contain credentials", async () => {
    setDropboxEnv();
    setupPersonalAccount();
    mockFilesDownload.mockRejectedValue({
      status: 500,
      message: "server error with client_id=fake-client-id",
    });

    try {
      await dropbox.downloadFile("/file");
    } catch (e: any) {
      expect(e.message).not.toContain("fake-client-id");
      expect(e.message).not.toContain("fake-secret");
      expect(e.message).not.toContain("fake-refresh-token");
      expect(e.message).toMatch(/^Storage error:/);
      expect(e.message).not.toContain("fake-client-id");
    }
  });
});
