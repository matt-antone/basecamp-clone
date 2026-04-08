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
