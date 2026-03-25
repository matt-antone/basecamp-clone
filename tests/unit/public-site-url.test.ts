import { afterEach, describe, expect, it } from "vitest";
import { getPublicSiteUrl } from "@/lib/public-site-url";

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (typeof originalSiteUrl === "string") {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
    return;
  }

  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("getPublicSiteUrl", () => {
  it("prefers the configured public site url", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://projects.example.com/login?next=%2F";

    expect(getPublicSiteUrl("https://ignored.example.com")).toBe("https://projects.example.com");
  });

  it("normalizes a bare production host", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "projects.example.com";

    expect(getPublicSiteUrl("https://ignored.example.com")).toBe("https://projects.example.com");
  });

  it("falls back to the current origin when no public site url is configured", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;

    expect(getPublicSiteUrl("https://app.example.com")).toBe("https://app.example.com");
  });
});
