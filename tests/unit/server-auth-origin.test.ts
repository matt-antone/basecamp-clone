import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { buildAppRedirectUrl, buildGoogleCallbackUrl } from "@/lib/server-auth";

const originalNextPublicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const originalUrl = process.env.URL;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (typeof originalNextPublicSiteUrl === "string") {
    process.env.NEXT_PUBLIC_SITE_URL = originalNextPublicSiteUrl;
  } else {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  }

  if (typeof originalUrl === "string") {
    process.env.URL = originalUrl;
  } else {
    delete process.env.URL;
  }

  if (typeof originalNodeEnv === "string") {
    process.env.NODE_ENV = originalNodeEnv;
  } else {
    delete process.env.NODE_ENV;
  }
});

describe("server auth origin resolution", () => {
  it("uses request.url origin in non-production when site url is not configured", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.URL;
    process.env.NODE_ENV = "test";

    const request = new NextRequest("http://localhost:3000/auth/google/callback?code=abc", {
      headers: {
        host: "localhost:3000",
        "x-forwarded-host": "projects.example.test",
        "x-forwarded-proto": "https"
      }
    });

    expect(buildAppRedirectUrl(request).toString()).toBe("http://localhost:3000/");
    expect(buildGoogleCallbackUrl(request)).toBe("http://localhost:3000/auth/google/callback");
  });

  it("prefers the configured site url when present", () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test";

    const request = new NextRequest("http://localhost:3000/auth/google/callback?code=abc", {
      headers: {
        "x-forwarded-host": "projects.example.test",
        "x-forwarded-proto": "https"
      }
    });

    expect(buildAppRedirectUrl(request).toString()).toBe("https://app.example.test/");
    expect(buildGoogleCallbackUrl(request)).toBe("https://app.example.test/auth/google/callback");
  });

  it("fails closed in production when site url is missing", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.URL;
    process.env.NODE_ENV = "production";

    const request = new NextRequest("http://localhost:3000/auth/google/callback?code=abc");

    expect(() => buildAppRedirectUrl(request)).toThrow("Missing required site URL for auth redirects");
    expect(() => buildGoogleCallbackUrl(request)).toThrow("Missing required site URL for auth redirects");
  });
});
