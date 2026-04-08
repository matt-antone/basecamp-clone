# MCP File Download & Client Read Tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `download_file`, `list_clients`, and `get_client` tools to the basecamp-mcp Supabase edge function.

**Architecture:** A new `dropbox.ts` helper uses raw `fetch()` against Dropbox REST APIs (token refresh, file download, temporary link). Two new db functions query the `clients` table. Three new tool registrations wire everything together in `tools.ts`.

**Tech Stack:** Deno (edge function runtime), Supabase JS client, Vitest, Dropbox REST API v2.

**Spec:** `docs/superpowers/specs/2026-04-08-mcp-file-download-and-clients-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/functions/basecamp-mcp/dropbox.ts` | Create | Fetch-based Dropbox client: token refresh, downloadFile, getTemporaryLink |
| `supabase/functions/basecamp-mcp/db.ts` | Modify | Add `listClients`, `getClient` |
| `supabase/functions/basecamp-mcp/tools.ts` | Modify | Add `download_file`, `list_clients`, `get_client` tool registrations |
| `tests/unit/mcp-dropbox.test.ts` | Create | Unit tests for Dropbox helper |
| `tests/unit/mcp-read-tools.test.ts` | Modify | Add `list_clients`, `get_client` tests |
| `tests/unit/mcp-file-profile-tools.test.ts` | Modify | Add `download_file` tests |
| `tests/integration/mcp-smoke.test.ts` | Modify | Extend smoke sequence for new tools |

---

### Task 1: Dropbox Helper — Token Refresh (test + implementation)

**Files:**
- Create: `tests/unit/mcp-dropbox.test.ts`
- Create: `supabase/functions/basecamp-mcp/dropbox.ts`

- [ ] **Step 1: Write the failing tests for token refresh**

Create `tests/unit/mcp-dropbox.test.ts`:

```typescript
// tests/unit/mcp-dropbox.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// We'll test the module's exported functions by mocking global fetch.
// The module reads Deno.env — we shim that for Node/Vitest.
const envMap = new Map<string, string>();
vi.stubGlobal("Deno", {
  env: {
    get: (key: string) => envMap.get(key) ?? undefined,
  },
});

// Import AFTER Deno stub is in place
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
    // envMap is empty — no DROPBOX_* vars
    await expect(dropbox._refreshAccessToken()).rejects.toThrow(
      "Dropbox credentials missing"
    );
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
cd "/Volumes/External/Glyphix Dropbox/Development Files/Under Development/Project Manager/basecamp-clone"
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-dropbox.test.ts
```

Expected: FAIL — module `dropbox.ts` does not exist yet.

- [ ] **Step 3: Write the Dropbox helper with token refresh**

Create `supabase/functions/basecamp-mcp/dropbox.ts`:

```typescript
// supabase/functions/basecamp-mcp/dropbox.ts

export class DropboxAuthError extends Error {
  constructor() {
    super("Dropbox authentication failed");
    this.name = "DropboxAuthError";
  }
}

export class DropboxConfigError extends Error {
  constructor() {
    super("Dropbox credentials missing");
    this.name = "DropboxConfigError";
  }
}

export class DropboxStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DropboxStorageError";
  }
}

// ─── Token cache ────────────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/** Test-only: reset cached token between tests. */
export function _resetTokenCache() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

function getConfig() {
  const clientId = Deno.env.get("DROPBOX_CLIENT_ID");
  const clientSecret = Deno.env.get("DROPBOX_CLIENT_SECRET");
  const refreshToken = Deno.env.get("DROPBOX_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new DropboxConfigError();
  }
  return {
    clientId,
    clientSecret,
    refreshToken,
    selectUser: Deno.env.get("DROPBOX_SELECT_USER"),
    selectAdmin: Deno.env.get("DROPBOX_SELECT_ADMIN"),
  };
}

export async function _refreshAccessToken(): Promise<string> {
  const config = getConfig();

  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
  });

  const res = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new DropboxAuthError();
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // Expire 60s early to avoid edge-of-expiry failures
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken!;
}

function teamHeaders(config: ReturnType<typeof getConfig>): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.selectUser) headers["Dropbox-API-Select-User"] = config.selectUser;
  if (config.selectAdmin) headers["Dropbox-API-Select-Admin"] = config.selectAdmin;
  return headers;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function getTemporaryLink(pathOrId: string): Promise<string> {
  const config = getConfig();
  const token = await _refreshAccessToken();

  const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...teamHeaders(config),
    },
    body: JSON.stringify({ path: pathOrId }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 409 && text.includes("not_found")) {
      throw new DropboxStorageError("File not found in storage");
    }
    if (res.status === 429) {
      throw new DropboxStorageError("Storage rate limited, try again later");
    }
    throw new DropboxStorageError("Storage error");
  }

  const data = await res.json();
  return data.link;
}

export async function downloadFile(
  pathOrId: string
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const config = getConfig();
  const token = await _refreshAccessToken();

  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path: pathOrId }),
      ...teamHeaders(config),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 409 && text.includes("not_found")) {
      throw new DropboxStorageError("File not found in storage");
    }
    if (res.status === 429) {
      throw new DropboxStorageError("Storage rate limited, try again later");
    }
    throw new DropboxStorageError("Storage error");
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get("Content-Type") ?? "application/octet-stream";
  return { bytes, contentType };
}
```

- [ ] **Step 4: Run the tests — verify they pass**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-dropbox.test.ts
```

Expected: All 4 token refresh tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/basecamp-mcp/dropbox.ts tests/unit/mcp-dropbox.test.ts
git commit -m "feat(mcp): add Dropbox helper with token refresh and error classes"
```

---

### Task 2: Dropbox Helper — downloadFile + getTemporaryLink tests

**Files:**
- Modify: `tests/unit/mcp-dropbox.test.ts`

- [ ] **Step 1: Add tests for getTemporaryLink**

Append to `tests/unit/mcp-dropbox.test.ts`:

```typescript
describe("getTemporaryLink", () => {
  it("returns temporary link URL", async () => {
    setDropboxEnv();
    const mockFetch = vi.fn()
      // First call: token refresh
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok", expires_in: 14400 }),
      })
      // Second call: get_temporary_link
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
```

- [ ] **Step 2: Add tests for downloadFile**

Append to `tests/unit/mcp-dropbox.test.ts`:

```typescript
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
```

- [ ] **Step 3: Add tests for team account headers**

Append to `tests/unit/mcp-dropbox.test.ts`:

```typescript
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
```

- [ ] **Step 4: Add secret safety test**

Append to `tests/unit/mcp-dropbox.test.ts`:

```typescript
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
```

- [ ] **Step 5: Run all Dropbox tests — verify they pass**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-dropbox.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/mcp-dropbox.test.ts
git commit -m "test(mcp): add Dropbox helper tests for download, temp link, team headers, secret safety"
```

---

### Task 3: DB Layer — listClients + getClient

**Files:**
- Modify: `supabase/functions/basecamp-mcp/db.ts`
- Modify: `tests/unit/mcp-read-tools.test.ts`

- [ ] **Step 1: Write failing tests for list_clients and get_client tools**

Append to `tests/unit/mcp-read-tools.test.ts` (before the closing of the file):

```typescript
describe("list_clients", () => {
  it("returns clients as JSON text content", async () => {
    vi.spyOn(db, "listClients").mockResolvedValue([
      { id: "c-1", name: "Acme Corp", code: "ACME", github_repos: [], domains: [], archived_at: null },
    ] as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("list_clients", {});
    expect(result.content[0].type).toBe("text");
    const data = JSON.parse(result.content[0].text);
    expect(data[0].name).toBe("Acme Corp");
    expect(data[0].code).toBe("ACME");
  });
});

describe("get_client", () => {
  it("returns client detail", async () => {
    vi.spyOn(db, "getClient").mockResolvedValue({
      id: "c-1", name: "Acme Corp", code: "ACME", github_repos: ["org/repo"], domains: ["acme.com"], archived_at: null,
    } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_client", { client_id: "c-1" });
    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe("Acme Corp");
    expect(data.domains).toEqual(["acme.com"]);
  });

  it("returns error when client not found", async () => {
    vi.spyOn(db, "getClient").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_client", { client_id: "bad-id" });
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-read-tools.test.ts
```

Expected: FAIL — `db.listClients` and `db.getClient` don't exist, tools not registered.

- [ ] **Step 3: Add listClients and getClient to db.ts**

Add to `supabase/functions/basecamp-mcp/db.ts` after the `// ─── Read` section, before the `// ─── Write` section:

```typescript
// ─── Clients ─────────────────────────────────────────────────────────────────

export async function listClients(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, code, github_repos, domains, archived_at")
    .order("name", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getClient(supabase: SupabaseClient, clientId: string) {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, code, github_repos, domains, archived_at")
    .eq("id", clientId)
    .single();
  if (error || !data) return null;
  return data;
}
```

- [ ] **Step 4: Register list_clients and get_client tools in tools.ts**

Add to `supabase/functions/basecamp-mcp/tools.ts` inside `registerTools`, after the `search_content` tool and before the `// ─── Write` comment:

```typescript
  // ─── Clients ────────────────────────────────────────────────────────────

  server.tool(
    "list_clients",
    "List all clients with name, code, domains, and archive status.",
    {},
    async () => {
      try {
        return ok(await db.listClients(supabase));
      } catch (e) {
        return dbError(e);
      }
    }
  );

  server.tool(
    "get_client",
    "Get a single client by ID including name, code, domains, github_repos, and archive status.",
    { client_id: z.string().uuid() },
    async ({ client_id }) => {
      try {
        const result = await db.getClient(supabase, client_id);
        if (!result) return notFound(client_id);
        return ok(result);
      } catch (e) {
        return dbError(e);
      }
    }
  );
```

- [ ] **Step 5: Run the tests — verify they pass**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-read-tools.test.ts
```

Expected: All tests PASS including the new `list_clients` and `get_client` tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/basecamp-mcp/db.ts supabase/functions/basecamp-mcp/tools.ts tests/unit/mcp-read-tools.test.ts
git commit -m "feat(mcp): add list_clients and get_client tools"
```

---

### Task 4: download_file Tool — Tests + Implementation

**Files:**
- Modify: `supabase/functions/basecamp-mcp/tools.ts`
- Modify: `tests/unit/mcp-file-profile-tools.test.ts`

- [ ] **Step 1: Write failing tests for download_file**

Add to `tests/unit/mcp-file-profile-tools.test.ts` after the existing imports:

```typescript
import * as dropbox from "../../supabase/functions/basecamp-mcp/dropbox.ts";
```

Then append the test describe block:

```typescript
describe("download_file", () => {
  const smallFile = {
    id: "f-1",
    project_id: "p-1",
    filename: "readme.txt",
    mime_type: "text/plain",
    size_bytes: 500,
    dropbox_file_id: "id:abc123",
    dropbox_path: "/projects/ACME/uploads/readme.txt",
    checksum: "sha256:aaa",
    thread_id: null,
    comment_id: null,
    uploader_user_id: "user-1",
    created_at: "2026-01-01",
  };

  const largeFile = {
    ...smallFile,
    id: "f-2",
    filename: "big-video.mp4",
    mime_type: "video/mp4",
    size_bytes: 5_000_000,
    dropbox_file_id: "id:xyz789",
  };

  it("returns base64 content for files <= 1MB", async () => {
    vi.spyOn(db, "getFile").mockResolvedValue(smallFile as any);
    const fileBytes = new TextEncoder().encode("hello world");
    vi.spyOn(dropbox, "downloadFile").mockResolvedValue({
      bytes: fileBytes,
      contentType: "text/plain",
    });
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("download_file", { file_id: "f-1" });
    const data = JSON.parse(result.content[0].text);
    expect(data.filename).toBe("readme.txt");
    expect(data.mime_type).toBe("text/plain");
    expect(data.size_bytes).toBe(500);
    expect(data.content_base64).toBeDefined();
    expect(data.download_url).toBeUndefined();
    // Decode and verify
    const decoded = atob(data.content_base64);
    expect(decoded).toBe("hello world");
  });

  it("returns download URL for files > 1MB", async () => {
    vi.spyOn(db, "getFile").mockResolvedValue(largeFile as any);
    vi.spyOn(dropbox, "getTemporaryLink").mockResolvedValue("https://dl.dropbox.com/temp-link");
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("download_file", { file_id: "f-2" });
    const data = JSON.parse(result.content[0].text);
    expect(data.filename).toBe("big-video.mp4");
    expect(data.download_url).toBe("https://dl.dropbox.com/temp-link");
    expect(data.expires_in_seconds).toBe(14400);
    expect(data.content_base64).toBeUndefined();
  });

  it("prefers dropbox_file_id over dropbox_path", async () => {
    vi.spyOn(db, "getFile").mockResolvedValue(smallFile as any);
    const dlSpy = vi.spyOn(dropbox, "downloadFile").mockResolvedValue({
      bytes: new Uint8Array(0),
      contentType: "text/plain",
    });
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("download_file", { file_id: "f-1" });
    expect(dlSpy).toHaveBeenCalledWith("id:abc123");
  });

  it("falls back to dropbox_path when dropbox_file_id is empty", async () => {
    const fileNoId = { ...smallFile, dropbox_file_id: "" };
    vi.spyOn(db, "getFile").mockResolvedValue(fileNoId as any);
    const dlSpy = vi.spyOn(dropbox, "downloadFile").mockResolvedValue({
      bytes: new Uint8Array(0),
      contentType: "text/plain",
    });
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("download_file", { file_id: "f-1" });
    expect(dlSpy).toHaveBeenCalledWith("/projects/ACME/uploads/readme.txt");
  });

  it("returns error when file not found", async () => {
    vi.spyOn(db, "getFile").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("download_file", { file_id: "bad-id" });
    expect(result.isError).toBe(true);
  });

  it("returns safe error when Dropbox credentials are missing", async () => {
    vi.spyOn(db, "getFile").mockResolvedValue(smallFile as any);
    vi.spyOn(dropbox, "downloadFile").mockRejectedValue(
      new dropbox.DropboxConfigError()
    );
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("download_file", { file_id: "f-1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("File download not configured — Dropbox credentials missing");
  });

  it("returns safe error on Dropbox storage errors", async () => {
    vi.spyOn(db, "getFile").mockResolvedValue(smallFile as any);
    vi.spyOn(dropbox, "downloadFile").mockRejectedValue(
      new dropbox.DropboxStorageError("File not found in storage")
    );
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("download_file", { file_id: "f-1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("File not found in storage");
  });

  it("does not expose dropbox_path or dropbox_file_id in response", async () => {
    vi.spyOn(db, "getFile").mockResolvedValue(smallFile as any);
    vi.spyOn(dropbox, "downloadFile").mockResolvedValue({
      bytes: new Uint8Array(0),
      contentType: "text/plain",
    });
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("download_file", { file_id: "f-1" });
    const text = result.content[0].text;
    expect(text).not.toContain("dropbox_path");
    expect(text).not.toContain("dropbox_file_id");
    expect(text).not.toContain("id:abc123");
    expect(text).not.toContain("/projects/ACME/uploads/readme.txt");
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-file-profile-tools.test.ts
```

Expected: FAIL — `download_file` tool is not registered yet.

- [ ] **Step 3: Add download_file tool to tools.ts**

Add import at the top of `supabase/functions/basecamp-mcp/tools.ts`:

```typescript
import * as dropbox from "./dropbox.ts";
```

Add a helper function after the existing `dbError` function:

```typescript
function dropboxError(e: unknown) {
  if (e instanceof dropbox.DropboxConfigError) {
    return { isError: true as const, content: [{ type: "text" as const, text: "File download not configured — Dropbox credentials missing" }] };
  }
  if (e instanceof dropbox.DropboxStorageError) {
    return { isError: true as const, content: [{ type: "text" as const, text: e.message }] };
  }
  if (e instanceof dropbox.DropboxAuthError) {
    return { isError: true as const, content: [{ type: "text" as const, text: "Dropbox authentication failed" }] };
  }
  return { isError: true as const, content: [{ type: "text" as const, text: "Storage error" }] };
}
```

Add inside `registerTools`, after the `create_file` tool and before the `// ─── Profile` comment:

```typescript
  const FILE_SIZE_INLINE_LIMIT = 1_048_576; // 1MB

  server.tool(
    "download_file",
    "Download file content or get a temporary link. Files ≤1MB return base64 content inline. Files >1MB return a temporary download URL valid ~4 hours.",
    { file_id: z.string().uuid() },
    async ({ file_id }) => {
      try {
        const file = await db.getFile(supabase, file_id);
        if (!file) return notFound(file_id);

        const target =
          typeof file.dropbox_file_id === "string" && file.dropbox_file_id.trim().length > 0
            ? file.dropbox_file_id
            : file.dropbox_path;

        if (file.size_bytes <= FILE_SIZE_INLINE_LIMIT) {
          const { bytes } = await dropbox.downloadFile(target);
          // Convert Uint8Array to base64
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const content_base64 = btoa(binary);
          return ok({
            filename: file.filename,
            mime_type: file.mime_type,
            size_bytes: file.size_bytes,
            content_base64,
          });
        } else {
          const download_url = await dropbox.getTemporaryLink(target);
          return ok({
            filename: file.filename,
            mime_type: file.mime_type,
            size_bytes: file.size_bytes,
            download_url,
            expires_in_seconds: 14400,
          });
        }
      } catch (e) {
        return dropboxError(e);
      }
    }
  );
```

- [ ] **Step 4: Run the tests — verify they pass**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-file-profile-tools.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/basecamp-mcp/tools.ts tests/unit/mcp-file-profile-tools.test.ts
git commit -m "feat(mcp): add download_file tool with hybrid base64/URL response"
```

---

### Task 5: Update Integration Smoke Test

**Files:**
- Modify: `tests/integration/mcp-smoke.test.ts`

- [ ] **Step 1: Update tools/list count and add tool name assertions**

In `tests/integration/mcp-smoke.test.ts`, find the existing `tools/list` test that checks `toHaveLength(15)` and update it:

Change:
```typescript
    expect(response.result?.tools).toHaveLength(15);
```
To:
```typescript
    expect(response.result?.tools).toHaveLength(18);
```

Add after the existing `expect(names).toContain("get_my_profile");` line:

```typescript
    expect(names).toContain("list_clients");
    expect(names).toContain("get_client");
    expect(names).toContain("download_file");
```

- [ ] **Step 2: Add live smoke test for list_clients**

Append to the `describe("MCP smoke tests (live)")` block:

```typescript
  it("list_clients returns an array when live smoke config is present", async () => {
    if (!smoke.isConfigured) {
      expectMissingConfig();
      return;
    }

    const response = await mcpCall("tools/call", { name: "list_clients", arguments: {} });
    expect(response.result).toBeDefined();
    expect(response.error).toBeUndefined();
    const data = JSON.parse(response.result.content[0].text);
    expect(Array.isArray(data)).toBe(true);
  });
```

- [ ] **Step 3: Run the smoke tests (offline — verifies structure)**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/integration/mcp-smoke.test.ts
```

Expected: Config tests PASS (live tests skip if env not configured).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/mcp-smoke.test.ts
git commit -m "test(mcp): update smoke test for 18 tools, add list_clients live test"
```

---

### Task 6: Run Full Test Suite + Final Verification

**Files:** None — verification only.

- [ ] **Step 1: Run all MCP-related unit tests**

```bash
TMPDIR=/tmp/codex-vitest npx vitest run tests/unit/mcp-dropbox.test.ts tests/unit/mcp-read-tools.test.ts tests/unit/mcp-file-profile-tools.test.ts tests/unit/mcp-auth.test.ts
```

Expected: All PASS.

- [ ] **Step 2: Run the full test suite**

```bash
TMPDIR=/tmp/codex-vitest npm run test
```

Expected: New tests PASS. Pre-existing failures in non-MCP tests are acceptable (known issue per memory).

- [ ] **Step 3: Verify no secrets in any test output or source**

```bash
grep -rn "fake-client-id\|fake-secret\|fake-refresh-token" tests/unit/mcp-dropbox.test.ts
# Should only appear in test setup (setDropboxEnv), never in assertions checking error messages
```

- [ ] **Step 4: Document the required Supabase secrets**

The following secrets must be set on the Supabase project for `download_file` to work in production. No code change needed — this is a deployment step:

```bash
supabase secrets set DROPBOX_CLIENT_ID=<value>
supabase secrets set DROPBOX_CLIENT_SECRET=<value>
supabase secrets set DROPBOX_REFRESH_TOKEN=<value>
# Optional for team accounts:
supabase secrets set DROPBOX_SELECT_USER=<value>
supabase secrets set DROPBOX_SELECT_ADMIN=<value>
```

Without these secrets, `download_file` returns a clear error; all other tools work normally.
