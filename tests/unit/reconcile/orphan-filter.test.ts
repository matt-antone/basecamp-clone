// tests/unit/reconcile/orphan-filter.test.ts
import { describe, it, expect } from "vitest";
import { applyOrphanFilter } from "@/lib/imports/reconcile/orphan-filter";

describe("applyOrphanFilter", () => {
  const project = { created_at: new Date("2026-01-15T00:00:00Z") };

  it("drops items strictly before project.created_at", () => {
    const items = [
      { id: 1, created_at: new Date("2026-01-14T23:59:59Z") },
      { id: 2, created_at: new Date("2026-01-15T00:00:00Z") },
      { id: 3, created_at: new Date("2026-01-16T00:00:00Z") },
    ];
    const r = applyOrphanFilter(items, project);
    expect(r.dropped.map((x) => x.id)).toEqual([1]);
    expect(r.kept.map((x) => x.id)).toEqual([2, 3]);
  });

  it("keeps everything when project is at epoch", () => {
    const items = [{ id: 1, created_at: new Date("2026-01-01T00:00:00Z") }];
    const r = applyOrphanFilter(items, { created_at: new Date(0) });
    expect(r.dropped).toEqual([]);
    expect(r.kept.length).toBe(1);
  });

  it("returns empty arrays for empty input", () => {
    const r = applyOrphanFilter([], project);
    expect(r).toEqual({ kept: [], dropped: [] });
  });
});
