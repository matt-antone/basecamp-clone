import { describe, expect, it } from "vitest";
import { formatProjectCreatedAtLocal } from "@/lib/project-utils";

describe("formatProjectCreatedAtLocal", () => {
  it("returns null for empty input", () => {
    expect(formatProjectCreatedAtLocal(null)).toBeNull();
    expect(formatProjectCreatedAtLocal(undefined)).toBeNull();
    expect(formatProjectCreatedAtLocal("   ")).toBeNull();
  });

  it("returns null for invalid iso", () => {
    expect(formatProjectCreatedAtLocal("not-a-date")).toBeNull();
  });

  it("formats a valid ISO string", () => {
    const out = formatProjectCreatedAtLocal("2025-06-15T12:00:00.000Z");
    expect(out).toBeTruthy();
    expect(out).toMatch(/2025/);
    expect(out).toMatch(/15/);
  });
});
