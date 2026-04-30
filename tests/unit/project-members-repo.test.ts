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
