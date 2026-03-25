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
    getSiteSettingsMock.mockResolvedValue({
      siteTitle: "Campfire HQ",
      logoUrl: "/logo.svg"
    });

    const { GET } = await import("@/app/site-settings/route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      siteSettings: {
        siteTitle: "Campfire HQ",
        logoUrl: "/logo.svg"
      }
    });
  });

  it("trims and persists site settings from PATCH", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    upsertSiteSettingsMock.mockResolvedValue({
      siteTitle: "Campfire HQ",
      logoUrl: "/logo.svg"
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
          logoUrl: "  /logo.svg  "
        })
      })
    );

    expect(response.status).toBe(200);
    expect(upsertSiteSettingsMock).toHaveBeenCalledWith({
      siteTitle: "Campfire HQ",
      logoUrl: "/logo.svg"
    });
    await expect(response.json()).resolves.toEqual({
      siteSettings: {
        siteTitle: "Campfire HQ",
        logoUrl: "/logo.svg"
      }
    });
  });
});
