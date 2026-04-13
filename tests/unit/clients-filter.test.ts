import { describe, expect, it } from "vitest";
import type { ClientRecord } from "@/lib/types/client-record";
import {
  filterClientsByArchiveState,
  isClientArchived,
  partitionClientsByArchiveState
} from "@/lib/clients-filter";

function makeClient(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    id: "client-id",
    name: "Client",
    code: "CLT",
    github_repos: [],
    domains: [],
    created_at: "2026-01-01T00:00:00.000Z",
    archived_at: null,
    ...overrides
  };
}

const ACTIVE_A = makeClient({ id: "a", name: "Acme", code: "ACM", archived_at: null });
const ACTIVE_B = makeClient({ id: "b", name: "Bravo", code: "BRV" });
const ARCHIVED_C = makeClient({
  id: "c",
  name: "Charlie",
  code: "CHR",
  archived_at: "2026-03-01T12:00:00.000Z"
});
const ARCHIVED_D = makeClient({
  id: "d",
  name: "Delta",
  code: "DLT",
  archived_at: "2026-04-01T12:00:00.000Z"
});

describe("isClientArchived", () => {
  it("returns false when archived_at is null", () => {
    expect(isClientArchived(ACTIVE_A)).toBe(false);
  });

  it("returns false when archived_at is undefined", () => {
    expect(isClientArchived(makeClient({ archived_at: undefined }))).toBe(false);
  });

  it("returns true when archived_at is a non-empty ISO string", () => {
    expect(isClientArchived(ARCHIVED_C)).toBe(true);
  });
});

describe("filterClientsByArchiveState", () => {
  it("returns only active clients when filter is 'active'", () => {
    const result = filterClientsByArchiveState(
      [ACTIVE_A, ARCHIVED_C, ACTIVE_B, ARCHIVED_D],
      "active"
    );
    expect(result.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("returns only archived clients when filter is 'archived'", () => {
    const result = filterClientsByArchiveState(
      [ACTIVE_A, ARCHIVED_C, ACTIVE_B, ARCHIVED_D],
      "archived"
    );
    expect(result.map((c) => c.id)).toEqual(["c", "d"]);
  });

  it("returns an empty array when no clients match the filter", () => {
    expect(filterClientsByArchiveState([ACTIVE_A, ACTIVE_B], "archived")).toEqual([]);
    expect(filterClientsByArchiveState([ARCHIVED_C], "active")).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(filterClientsByArchiveState([], "active")).toEqual([]);
    expect(filterClientsByArchiveState([], "archived")).toEqual([]);
  });

  it("preserves input order within the filtered result", () => {
    const result = filterClientsByArchiveState(
      [ARCHIVED_C, ACTIVE_A, ARCHIVED_D, ACTIVE_B],
      "active"
    );
    expect(result.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("partitionClientsByArchiveState", () => {
  it("splits a mixed list into active and archived buckets", () => {
    const result = partitionClientsByArchiveState([
      ACTIVE_A,
      ARCHIVED_C,
      ACTIVE_B,
      ARCHIVED_D
    ]);
    expect(result.active.map((c) => c.id)).toEqual(["a", "b"]);
    expect(result.archived.map((c) => c.id)).toEqual(["c", "d"]);
  });

  it("returns empty arrays for empty input", () => {
    const result = partitionClientsByArchiveState([]);
    expect(result.active).toEqual([]);
    expect(result.archived).toEqual([]);
  });

  it("routes all clients into active when none are archived", () => {
    const result = partitionClientsByArchiveState([ACTIVE_A, ACTIVE_B]);
    expect(result.active).toHaveLength(2);
    expect(result.archived).toHaveLength(0);
  });

  it("routes all clients into archived when all are archived", () => {
    const result = partitionClientsByArchiveState([ARCHIVED_C, ARCHIVED_D]);
    expect(result.active).toHaveLength(0);
    expect(result.archived).toHaveLength(2);
  });
});
