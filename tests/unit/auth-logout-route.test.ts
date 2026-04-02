import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const clearAuthSessionCookiesMock = vi.fn();

vi.mock("@/lib/server-auth", () => ({
  clearAuthSessionCookies: clearAuthSessionCookiesMock
}));

describe("/auth/logout route", () => {
  it("returns 405 for GET", async () => {
    const { GET } = await import("@/app/auth/logout/route");
    const response = await GET(new NextRequest("http://localhost/auth/logout"));

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({ error: "Method not allowed" });
    expect(clearAuthSessionCookiesMock).not.toHaveBeenCalled();
  });

  it("keeps POST logout behavior (redirect + cookie clear)", async () => {
    const { POST } = await import("@/app/auth/logout/route");
    const response = await POST(new NextRequest("http://localhost/auth/logout", { method: "POST" }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(clearAuthSessionCookiesMock).toHaveBeenCalledTimes(1);
  });
});
