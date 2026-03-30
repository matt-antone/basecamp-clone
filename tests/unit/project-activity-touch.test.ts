import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: queryMock
}));

describe("touchProjectActivity", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
  });

  it("issues an UPDATE setting last_activity_at = now() for the project", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { touchProjectActivity } = await import("@/lib/repositories");
    await touchProjectActivity("project-abc");

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("update projects");
    expect(sql).toContain("last_activity_at = now()");
    expect(params).toEqual(["project-abc"]);
  });

  it("does not throw when last_activity_at column does not yet exist", async () => {
    queryMock.mockRejectedValueOnce(new Error('column "last_activity_at" does not exist'));

    const { touchProjectActivity } = await import("@/lib/repositories");
    await expect(touchProjectActivity("project-abc")).resolves.toBeUndefined();
  });
});
