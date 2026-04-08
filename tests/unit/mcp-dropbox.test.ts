// tests/unit/mcp-dropbox.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const envMap = new Map<string, string>();
vi.stubGlobal("Deno", {
  env: {
    get: (key: string) => envMap.get(key) ?? undefined,
  },
});

const dropbox = await import("../../supabase/functions/basecamp-mcp/dropbox.ts");

beforeEach(() => {
  envMap.clear();
  vi.restoreAllMocks();
  dropbox._resetTokenCache();
});

function setDropboxEnv() {
  envMap.set("DROPBOX_CLIENT_ID", "fake-client-id");
  envMap.set("DROPBOX_CLIENT_SECRET", "fake-secret");
  envMap.set("DROPBOX_REFRESH_TOKEN", "fake-refresh-token");
}

describe("refreshAccessToken", () => {
  it("sends correct OAuth2 body and returns access token", async () => {
    setDropboxEnv();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "new-access-token", expires_in: 14400 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const token = await dropbox._refreshAccessToken();

    expect(token).toBe("new-access-token");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.dropbox.com/oauth2/token");
    expect(opts.method).toBe("POST");
    const body = opts.body as string;
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("client_id=fake-client-id");
    expect(body).toContain("client_secret=fake-secret");
    expect(body).toContain("refresh_token=fake-refresh-token");
  });

  it("caches the token on subsequent calls", async () => {
    setDropboxEnv();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "cached-token", expires_in: 14400 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await dropbox._refreshAccessToken();
    await dropbox._refreshAccessToken();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws DropboxAuthError on refresh failure without leaking credentials", async () => {
    setDropboxEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error": "invalid_grant"}'),
    }));

    await expect(dropbox._refreshAccessToken()).rejects.toThrow("Dropbox authentication failed");
  });

  it("throws DropboxConfigError when credentials are missing", async () => {
    await expect(dropbox._refreshAccessToken()).rejects.toThrow(
      "Dropbox credentials missing"
    );
  });
});

describe("getTemporaryLink", () => {
  it("returns temporary link URL", async () => {
    setDropboxEnv();
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok", expires_in: 14400 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ link: "https://dl.dropbox.com/temp-link" }),
      });
    vi.stubGlobal("fetch", mockFetch);

    const link = await dropbox.getTemporaryLink("id:abc123");

    expect(link).toBe("https://dl.dropbox.com/temp-link");
    const [url, opts] = mockFetch.mock.calls[1];
    expect(url).toBe("https://api.dropboxapi.com/2/files/get_temporary_link");
    expect(JSON.parse(opts.body)).toEqual({ path: "id:abc123" });
  });

  it("throws 'File not found in storage' on 409 not_found", async () => {
    setDropboxEnv();
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok", expires_in: 14400 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: () => Promise.resolve('{"error_summary": "path/not_found/"}'),
      });
    vi.stubGlobal("fetch", mockFetch);

    await expect(dropbox.getTemporaryLink("/missing")).rejects.toThrow("File not found in storage");
  });

  it("throws 'Storage rate limited' on 429", async () => {
    setDropboxEnv();
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok", expires_in: 14400 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve("rate limited"),
      });
    vi.stubGlobal("fetch", mockFetch);

    await expect(dropbox.getTemporaryLink("/file")).rejects.toThrow("Storage rate limited");
  });
});

describe("downloadFile", () => {
  it("returns bytes and content type", async () => {
    setDropboxEnv();
    const fileBytes = new TextEncoder().encode("hello world");
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok", expires_in: 14400 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(fileBytes.buffer),
        headers: new Headers({ "Content-Type": "text/plain" }),
      });
    vi.stubGlobal("fetch", mockFetch);

    const result = await dropbox.downloadFile("id:abc123");

    expect(result.contentType).toBe("text/plain");
    expect(new TextDecoder().decode(result.bytes)).toBe("hello world");
    const [, opts] = mockFetch.mock.calls[1];
    expect(opts.headers["Dropbox-API-Arg"]).toBe(JSON.stringify({ path: "id:abc123" }));
  });

  it("throws 'File not found in storage' on 409 not_found", async () => {
    setDropboxEnv();
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok", expires_in: 14400 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: () => Promise.resolve('{"error_summary": "path/not_found/"}'),
      });
    vi.stubGlobal("fetch", mockFetch);

    await expect(dropbox.downloadFile("/missing")).rejects.toThrow("File not found in storage");
  });

  it("defaults content type to application/octet-stream", async () => {
    setDropboxEnv();
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok", expires_in: 14400 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        headers: new Headers(),
      });
    vi.stubGlobal("fetch", mockFetch);

    const result = await dropbox.downloadFile("id:xyz");
    expect(result.contentType).toBe("application/octet-stream");
  });
});

describe("team headers", () => {
  it("includes Dropbox-API-Select-User header when env var is set", async () => {
    setDropboxEnv();
    envMap.set("DROPBOX_SELECT_USER", "dbmid:user123");
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok", expires_in: 14400 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ link: "https://dl.dropbox.com/link" }),
      });
    vi.stubGlobal("fetch", mockFetch);

    await dropbox.getTemporaryLink("/file");

    const headers = mockFetch.mock.calls[1][1].headers;
    expect(headers["Dropbox-API-Select-User"]).toBe("dbmid:user123");
  });

  it("includes Dropbox-API-Select-Admin header when env var is set", async () => {
    setDropboxEnv();
    envMap.set("DROPBOX_SELECT_ADMIN", "dbmid:admin456");
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok", expires_in: 14400 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        headers: new Headers({ "Content-Type": "image/png" }),
      });
    vi.stubGlobal("fetch", mockFetch);

    await dropbox.downloadFile("/file");

    const headers = mockFetch.mock.calls[1][1].headers;
    expect(headers["Dropbox-API-Select-Admin"]).toBe("dbmid:admin456");
  });
});

describe("secret safety", () => {
  it("error messages never contain credentials", async () => {
    setDropboxEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error": "invalid_grant", "client_id": "fake-client-id"}'),
    }));

    try {
      await dropbox._refreshAccessToken();
    } catch (e: any) {
      expect(e.message).not.toContain("fake-client-id");
      expect(e.message).not.toContain("fake-secret");
      expect(e.message).not.toContain("fake-refresh-token");
      expect(e.message).toBe("Dropbox authentication failed");
    }
  });
});
