import { beforeEach, describe, expect, it, vi } from "vitest";

describe("email config", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgres://localhost/postgres";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.WORKSPACE_DOMAIN = "example.com";
    delete process.env.EMAIL_ENABLED;
    delete process.env.EMAIL_FROM;
    delete process.env.MAILGUN_EMAIL;
    process.env.MAILGUN_API_KEY = "key-test";
    process.env.MAILGUN_DOMAIN = "mg.example.com";
    delete process.env.MAILGUN_BASE_URL;
  });

  it("uses email defaults when optional env vars are unset", async () => {
    const { config } = await import("@/lib/config");

    expect(config.emailEnabled()).toBe(true);
    expect(config.mailgunBaseUrl()).toBe("https://api.mailgun.net");
  });

  it("falls back to MAILGUN_EMAIL when EMAIL_FROM is unset", async () => {
    process.env.MAILGUN_EMAIL = "notifications@yourcompany.com";

    const { config } = await import("@/lib/config");

    expect(config.emailFrom()).toBe("notifications@yourcompany.com");
  });

  it("requires EMAIL_FROM or MAILGUN_EMAIL when email is enabled", async () => {
    const { config } = await import("@/lib/config");

    expect(() => config.emailFrom()).toThrow("Missing required env var: EMAIL_FROM or MAILGUN_EMAIL");
  });

  it("requires MAILGUN credentials when email is enabled", async () => {
    delete process.env.MAILGUN_API_KEY;
    delete process.env.MAILGUN_DOMAIN;

    const { config } = await import("@/lib/config");

    expect(() => config.mailgunApiKey()).toThrow("Missing required env var: MAILGUN_API_KEY");
    expect(() => config.mailgunDomain()).toThrow("Missing required env var: MAILGUN_DOMAIN");
  });

  it("allows email to be disabled without a sender address", async () => {
    process.env.EMAIL_ENABLED = "false";

    const { config } = await import("@/lib/config");

    expect(config.emailEnabled()).toBe(false);
  });
});
