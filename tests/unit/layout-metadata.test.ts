import { beforeEach, describe, expect, it, vi } from "vitest";

const getSiteSettingsMock = vi.fn();

vi.mock("@/lib/repositories", () => ({
  getSiteSettings: getSiteSettingsMock
}));

vi.mock("next/font/google", () => ({
  Instrument_Sans: () => ({ className: "instrument-sans" }),
  Newsreader: () => ({ variable: "--font-display" })
}));

vi.mock("next/script", () => ({
  default: () => null
}));

describe("layout metadata", () => {
  beforeEach(() => {
    getSiteSettingsMock.mockReset();
  });

  it("uses the saved site title for the document title", async () => {
    getSiteSettingsMock.mockResolvedValue({
      siteTitle: "  Campfire HQ  ",
      logoUrl: "/logo.svg"
    });

    const { generateMetadata } = await import("@/app/layout");

    await expect(generateMetadata()).resolves.toEqual({
      title: "Campfire HQ",
      description: "Basecamp 2 replacement with Supabase + Dropbox"
    });
  });

  it("falls back to the default site title when settings are missing", async () => {
    getSiteSettingsMock.mockResolvedValue(null);

    const { generateMetadata } = await import("@/app/layout");

    await expect(generateMetadata()).resolves.toEqual({
      title: "Project Manager",
      description: "Basecamp 2 replacement with Supabase + Dropbox"
    });
  });

  it("falls back to the default site title when loading settings fails", async () => {
    getSiteSettingsMock.mockRejectedValue(new Error("database unavailable"));

    const { generateMetadata } = await import("@/app/layout");

    await expect(generateMetadata()).resolves.toEqual({
      title: "Project Manager",
      description: "Basecamp 2 replacement with Supabase + Dropbox"
    });
  });
});
