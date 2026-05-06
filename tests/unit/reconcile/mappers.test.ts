import { describe, it, expect, vi } from "vitest";
import { createMappers } from "@/lib/imports/reconcile/mappers";

function fakePool(rows: Record<string, any[]>) {
  const calls: { sql: string; params: any[] }[] = [];
  return {
    calls,
    query: vi.fn(async (sql: string, params: any[]) => {
      calls.push({ sql, params });
      if (sql.includes("bc2_projects_map")) {
        const key = params[0];
        return { rows: rows[`projects:${key}`] ?? [] };
      }
      if (sql.includes("bc2_people_map")) {
        const key = params[0];
        return { rows: rows[`people:${key}`] ?? [] };
      }
      if (sql.includes("FROM clients")) {
        const key = params[0];
        return { rows: rows[`clients:${key}`] ?? [] };
      }
      return { rows: [] };
    }),
  } as any;
}

describe("mappers", () => {
  it("prodProjectIdToBc2Id returns null when missing", async () => {
    const pool = fakePool({});
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.prodProjectIdToBc2Id(42)).toBeNull();
  });

  it("caches prod project lookup", async () => {
    const pool = fakePool({ "projects:42": [{ bc2_id: 100 }] });
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.prodProjectIdToBc2Id(42)).toBe(100);
    expect(await m.prodProjectIdToBc2Id(42)).toBe(100);
    expect(pool.calls.length).toBe(1);
  });

  it("bc2IdToTestProjectId hits test side", async () => {
    const pool = fakePool({ "projects:100": [{ project_id: 7 }] });
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.bc2IdToTestProjectId(100)).toBe(7);
  });

  it("prodUserIdToTestUserId returns null when prod side missing", async () => {
    const pool = fakePool({});
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.prodUserIdToTestUserId(99)).toBeNull();
  });

  it("prodUserIdToTestUserId returns null when test side missing", async () => {
    const pool = fakePool({ "people:99": [{ bc2_id: 555 }] });
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.prodUserIdToTestUserId(99)).toBeNull();
  });

  it("prodUserIdToTestUserId resolves end-to-end", async () => {
    const pool = fakePool({
      "people:99": [{ bc2_id: 555 }],
      "people:555": [{ user_id: 8 }],
    });
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.prodUserIdToTestUserId(99)).toBe(8);
  });

  it("testClientIdByCode returns null when code unknown", async () => {
    const pool = fakePool({});
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.testClientIdByCode("ACME")).toBeNull();
  });

  it("testClientIdByCode caches lookups", async () => {
    const pool = fakePool({ "clients:ACME": [{ id: 3 }] });
    const m = createMappers({ prodPool: pool, testPool: pool });
    expect(await m.testClientIdByCode("ACME")).toBe(3);
    expect(await m.testClientIdByCode("ACME")).toBe(3);
    expect(pool.calls.length).toBe(1);
  });
});
