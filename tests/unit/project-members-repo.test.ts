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
