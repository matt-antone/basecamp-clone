// tests/unit/bc2-transformer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseProjectTitle, resolvePerson } from "@/lib/imports/bc2-transformer";
import * as db from "@/lib/db";
import type { Bc2Person } from "@/lib/imports/bc2-fetcher";

vi.mock("@/lib/db", () => ({
  query: vi.fn()
}));

const mockQuery = db.query as ReturnType<typeof vi.fn>;

describe("parseProjectTitle", () => {
  it("parses standard format with number", () => {
    const r = parseProjectTitle("Poms-1414: Purple Mushroom Package");
    expect(r).toEqual({ code: "Poms", num: "1414", title: "Purple Mushroom Package" });
  });

  it("parses four-digit codes", () => {
    const r = parseProjectTitle("JFLA-444: Invitation Graphic");
    expect(r).toEqual({ code: "JFLA", num: "444", title: "Invitation Graphic" });
  });

  it("parses format without number (hyphen dash)", () => {
    const r = parseProjectTitle("GX-Website Review");
    expect(r).toEqual({ code: "GX", num: null, title: "Website Review" });
  });

  it("parses format without number (spaced dash)", () => {
    const r = parseProjectTitle("POMS - Website Software Update");
    expect(r).toEqual({ code: "POMS", num: null, title: "Website Software Update" });
  });

  it("returns null code and num for unrecognized format", () => {
    const r = parseProjectTitle("Some random project name");
    expect(r).toEqual({ code: null, num: null, title: "Some random project name" });
  });

  it("strips whitespace from title", () => {
    const r = parseProjectTitle("ALG-100:  Spaced Title  ");
    expect(r).toEqual({ code: "ALG", num: "100", title: "Spaced Title" });
  });
});

describe("resolvePerson", () => {
  const person: Bc2Person = {
    id: 42,
    name: "Alice Smith",
    email_address: "alice@example.com",
    avatar_url: null,
    title: "Designer",
    time_zone: "America/New_York"
  };

  beforeEach(() => mockQuery.mockReset());

  it("returns existing profile id when email matches", async () => {
    // 1st query: check import_map_people — not found
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 2nd query: lookup user_profiles by email — found
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "existing-uuid" }] });
    // 3rd query: insert into import_map_people
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await resolvePerson(person, "job-1");
    expect(result.localProfileId).toBe("existing-uuid");
    expect(result.isLegacy).toBe(false);
  });

  it("creates legacy profile when no email match", async () => {
    // 1st query: check import_map_people — not found
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 2nd query: lookup user_profiles by email — not found
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 3rd query: insert legacy user_profile
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "bc2_42" }] });
    // 4th query: insert into import_map_people
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await resolvePerson(person, "job-1");
    expect(result.localProfileId).toBe("bc2_42");
    expect(result.isLegacy).toBe(true);
  });

  it("returns already-mapped profile without re-inserting", async () => {
    // 1st query: check import_map_people — found
    mockQuery.mockResolvedValueOnce({ rows: [{ local_user_profile_id: "cached-uuid" }] });

    const result = await resolvePerson(person, "job-1");
    expect(result.localProfileId).toBe("cached-uuid");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
