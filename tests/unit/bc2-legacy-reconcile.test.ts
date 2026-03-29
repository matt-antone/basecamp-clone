// tests/unit/bc2-legacy-reconcile.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as db from "@/lib/db";
import { reconcileLegacyProfile } from "@/lib/imports/bc2-transformer";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
const mockQuery = db.query as ReturnType<typeof vi.fn>;

describe("reconcileLegacyProfile", () => {
  beforeEach(() => mockQuery.mockReset());

  it("updates legacy profile id and clears is_legacy flag", async () => {
    // Legacy profile found
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "bc2_42" }] });
    // Update user_profiles id
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Update import_map_people
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await reconcileLegacyProfile("alice@example.com", "google-uid-abc");
    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(3);

    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain("update user_profiles");
    expect(updateCall[1]).toContain("google-uid-abc");
  });

  it("returns false when no legacy profile found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await reconcileLegacyProfile("new@example.com", "google-uid-xyz");
    expect(result).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
