import { describe, expect, it } from "vitest";
import {
  collectNewOrUpdatedIds,
  collectNewIds,
  hasDirtyProjectPageDrafts,
  isNewerProjectUpdate
} from "@/lib/project-page-polling";

describe("isNewerProjectUpdate", () => {
  it("only treats strictly newer timestamps as updates", () => {
    expect(isNewerProjectUpdate("2026-04-30T12:05:00.000Z", "2026-04-30T12:00:00.000Z")).toBe(true);
    expect(isNewerProjectUpdate("2026-04-30T12:00:00.000Z", "2026-04-30T12:00:00.000Z")).toBe(false);
    expect(isNewerProjectUpdate("2026-04-30T11:55:00.000Z", "2026-04-30T12:00:00.000Z")).toBe(false);
  });
});

describe("collectNewIds", () => {
  it("returns ids not present in the seen set", () => {
    expect(collectNewIds([{ id: "a" }, { id: "b" }], new Set(["a"]))).toEqual(new Set(["b"]));
  });
});

describe("collectNewOrUpdatedIds", () => {
  it("returns existing ids when their activity timestamp is newer", () => {
    expect(
      collectNewOrUpdatedIds(
        [
          { id: "a", activityUpdatedAt: "2026-04-30T12:00:00.000Z" },
          { id: "b", activityUpdatedAt: "2026-04-30T12:10:00.000Z" },
          { id: "c", activityUpdatedAt: "2026-04-30T12:00:00.000Z" }
        ],
        new Set(["a", "b"]),
        new Map([
          ["a", "2026-04-30T12:00:00.000Z"],
          ["b", "2026-04-30T12:00:00.000Z"]
        ]),
        (item) => item.activityUpdatedAt
      )
    ).toEqual(new Set(["b", "c"]));
  });
});

describe("hasDirtyProjectPageDrafts", () => {
  const clean = {
    projectFormDirty: false,
    myHoursDirty: false,
    archivedHoursDirty: false,
    expenseDraftsDirty: false,
    newExpenseDirty: false,
    fileQueued: false,
    createDiscussionDirty: false,
    mutationInFlight: false
  };

  it("is false when no draft or mutation is active", () => {
    expect(hasDirtyProjectPageDrafts(clean)).toBe(false);
  });

  it("is true when any draft is dirty", () => {
    expect(hasDirtyProjectPageDrafts({ ...clean, expenseDraftsDirty: true })).toBe(true);
  });

  it("is true while a mutation is in flight", () => {
    expect(hasDirtyProjectPageDrafts({ ...clean, mutationInFlight: true })).toBe(true);
  });
});
