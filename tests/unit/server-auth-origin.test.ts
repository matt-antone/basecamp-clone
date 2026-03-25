import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { buildAppRedirectUrl, buildGoogleCallbackUrl } from "@/lib/server-auth";

const originalSiteUrl = process.env.SITE_URL;
const originalNextPublicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const originalUrl = process.env.URL;

afterEach(() => {
  if (typeof originalSiteUrl === "string") {
    process.env.SITE_URL = originalSiteUrl;
  } else {
    delete process.env.SITE_URL;
  }

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
});

describe("server auth origin resolution", () => {
  it("prefers forwarded host headers over the internal request url", () => {
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.URL;

    const request = new NextRequest("http://localhost:3000/auth/google/callback?code=abc", {
      headers: {
        host: "localhost:3000",
        "x-forwarded-host": "projects.glyphix.com",
        "x-forwarded-proto": "https"
      }
    });

    expect(buildAppRedirectUrl(request).toString()).toBe("https://projects.glyphix.com/");
    expect(buildGoogleCallbackUrl(request)).toBe("https://projects.glyphix.com/auth/google/callback");
  });

  it("prefers the configured site url when present", () => {
    process.env.SITE_URL = "https://app.glyphix.com";

    const request = new NextRequest("http://localhost:3000/auth/google/callback?code=abc", {
      headers: {
        "x-forwarded-host": "projects.glyphix.com",
        "x-forwarded-proto": "https"
      }
    });

    expect(buildAppRedirectUrl(request).toString()).toBe("https://app.glyphix.com/");
    expect(buildGoogleCallbackUrl(request)).toBe("https://app.glyphix.com/auth/google/callback");
  });
});
