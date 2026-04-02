import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getSiteSettingsMock = vi.fn();
const upsertSiteSettingsMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  getSiteSettings: getSiteSettingsMock,
  upsertSiteSettings: upsertSiteSettingsMock
}));

describe("/site-settings route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getSiteSettingsMock.mockReset();
    upsertSiteSettingsMock.mockReset();
  });

  it("returns normalized site settings from GET", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getSiteSettingsMock.mockResolvedValue({
      siteTitle: "Campfire HQ",
      logoUrl: "/logo.svg",
      defaultHourlyRateUsd: "175.50"
    });

    const { GET } = await import("@/app/site-settings/route");
    const response = await GET(new Request("http://localhost/site-settings"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      siteSettings: {
        siteTitle: "Campfire HQ",
        logoUrl: "/logo.svg",
        defaultHourlyRateUsd: 175.5
      }
    });
  });

  it("returns 401 from GET when auth fails", async () => {
    requireUserMock.mockRejectedValue(new Error("auth required"));

    const { GET } = await import("@/app/site-settings/route");
    const response = await GET(new Request("http://localhost/site-settings"));

    expect(response.status).toBe(401);
    expect(getSiteSettingsMock).not.toHaveBeenCalled();
  });

  it("trims and persists site settings from PATCH", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    upsertSiteSettingsMock.mockResolvedValue({
      siteTitle: "Campfire HQ",
      logoUrl: "/logo.svg",
      defaultHourlyRateUsd: "175.50"
    });

    const { PATCH } = await import("@/app/site-settings/route");
    const response = await PATCH(
      new Request("http://localhost/site-settings", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          siteTitle: "  Campfire HQ  ",
          logoUrl: "  /logo.svg  ",
          defaultHourlyRateUsd: 175.5
        })
      })
    );

    expect(response.status).toBe(200);
    expect(upsertSiteSettingsMock).toHaveBeenCalledWith({
      siteTitle: "Campfire HQ",
      logoUrl: "/logo.svg",
      defaultHourlyRateUsd: 175.5
    });
    await expect(response.json()).resolves.toEqual({
      siteSettings: {
        siteTitle: "Campfire HQ",
        logoUrl: "/logo.svg",
        defaultHourlyRateUsd: 175.5
      }
    });
  });

  it("rejects PATCH when the hourly rate exceeds the allowed range", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });

    const { PATCH } = await import("@/app/site-settings/route");
    const response = await PATCH(
      new Request("http://localhost/site-settings", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          defaultHourlyRateUsd: 1_000_000
        })
      })
    );

    expect(response.status).toBe(400);
    expect(upsertSiteSettingsMock).not.toHaveBeenCalled();
  });
});
