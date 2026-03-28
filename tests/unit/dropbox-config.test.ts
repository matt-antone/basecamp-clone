import { beforeEach, describe, expect, it, vi } from "vitest";

const legacyDropboxRoot = `/${["Pro", "jects"].join("")}`;

describe("Dropbox config", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgres://localhost/postgres";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.WORKSPACE_DOMAIN = "example.com";
    delete process.env.DROPBOX_PROJECTS_ROOT_FOLDER;
    delete process.env.DROPBOX_ROOT_FOLDER;
    delete process.env.THUMBNAIL_WORKER_URL;
    delete process.env.THUMBNAIL_WORKER_TOKEN;
    delete process.env.THUMBNAIL_WORKER_TIMEOUT_MS;
  });

  it("supports the legacy DROPBOX_ROOT_FOLDER env var", async () => {
    process.env.DROPBOX_ROOT_FOLDER = legacyDropboxRoot;

    const { config } = await import("@/lib/config");

    expect(config.dropboxProjectsRootFolder()).toBe(legacyDropboxRoot);
  });

  it("reads thumbnail worker settings when configured", async () => {
    process.env.THUMBNAIL_WORKER_URL = "https://thumbs.example.internal/";
    process.env.THUMBNAIL_WORKER_TOKEN = "token-123";
    process.env.THUMBNAIL_WORKER_TIMEOUT_MS = "20000";

    const { config } = await import("@/lib/config");

    expect(config.thumbnailWorkerUrl()).toBe("https://thumbs.example.internal");
    expect(config.thumbnailWorkerToken()).toBe("token-123");
    expect(config.thumbnailWorkerTimeoutMs()).toBe(20000);
  });

  it("rejects path-bearing thumbnail worker URLs with an actionable error", async () => {
    process.env.THUMBNAIL_WORKER_URL = "https://thumbs.example.internal/thumbnails/";

    const { config } = await import("@/lib/config");

    expect(() => config.thumbnailWorkerUrl()).toThrow(
      "THUMBNAIL_WORKER_URL must be origin-only, for example https://thumbs.example.internal. Remove any path such as /thumbnails."
    );
  });
});
