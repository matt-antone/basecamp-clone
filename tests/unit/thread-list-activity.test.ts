import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: queryMock
}));

describe("listThreads activity timestamps", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
  });

  it("includes comment activity so existing discussions can be marked new after comments", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { listThreads } = await import("@/lib/repositories");
    await listThreads("project-1");

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("latest_comment_updated_at");
    expect(sql).toContain("activity_updated_at");
    expect(sql).toContain("discussion_comments");
    expect(sql).toContain("order by activity_updated_at desc");
    expect(params).toEqual(["project-1"]);
  });
});
