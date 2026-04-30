import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: queryMock
}));

beforeEach(() => {
  queryMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("addProjectMember", () => {
  it("inserts a (project_id, user_id) row idempotently", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const { addProjectMember } = await import("@/lib/repositories");
    await addProjectMember("p1", "u1");
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringMatching(/insert into project_members.*on conflict.*do nothing/is),
      ["p1", "u1"]
    );
  });
});

describe("removeProjectMember", () => {
  it("deletes when more than one member remains", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ count: 2 }] }); // count
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // delete
    const { removeProjectMember } = await import("@/lib/repositories");
    await removeProjectMember("p1", "u1");
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/delete from project_members/i),
      ["p1", "u1"]
    );
  });

  it("throws when removing would leave zero members", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ count: 1 }] });
    const { removeProjectMember } = await import("@/lib/repositories");
    await expect(removeProjectMember("p1", "u1")).rejects.toThrow(
      /last member/i
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe("listProjectMembers", () => {
  it("returns members joined with user_profiles, ordered by added_at", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          user_id: "u1",
          email: "a@x.com",
          first_name: "Alex",
          last_name: "A",
          added_at: new Date("2026-04-30T00:00:00Z")
        }
      ]
    });
    const { listProjectMembers } = await import("@/lib/repositories");
    const result = await listProjectMembers("p1");
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe("a@x.com");
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringMatching(/from project_members.*join user_profiles/is),
      ["p1"]
    );
  });
});
