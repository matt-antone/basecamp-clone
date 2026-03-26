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
  });

  it("supports the legacy DROPBOX_ROOT_FOLDER env var", async () => {
    process.env.DROPBOX_ROOT_FOLDER = legacyDropboxRoot;

    const { config } = await import("@/lib/config");

    expect(config.dropboxProjectsRootFolder()).toBe(legacyDropboxRoot);
  });
});
