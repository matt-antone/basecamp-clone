import { beforeEach, describe, expect, it, vi } from "vitest";

describe("email config", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = "postgres://localhost/postgres";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.WORKSPACE_DOMAIN = "example.com";
    delete process.env.EMAIL_ENABLED;
    delete process.env.EMAIL_FROM;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USERNAME;
    delete process.env.SMTP_PASSWORD;
  });

  it("uses email defaults when optional env vars are unset", async () => {
    const { config } = await import("@/lib/config");

    expect(config.emailEnabled()).toBe(true);
    expect(config.smtpHost()).toBe("smtp-relay.gmail.com");
    expect(config.smtpPort()).toBe(587);
    expect(config.smtpSecure()).toBe(false);
  });

  it("requires EMAIL_FROM when email is enabled", async () => {
    const { config } = await import("@/lib/config");

    expect(() => config.emailFrom()).toThrow("Missing required env var: EMAIL_FROM");
  });

  it("allows email to be disabled without a sender address", async () => {
    process.env.EMAIL_ENABLED = "false";

    const { config } = await import("@/lib/config");

    expect(config.emailEnabled()).toBe(false);
  });
});
