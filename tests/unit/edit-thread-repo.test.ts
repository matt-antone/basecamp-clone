import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({ query: queryMock }));

beforeEach(() => queryMock.mockReset());
afterEach(() => vi.resetModules());

describe("editThread", () => {
  it("updates title, body_markdown, body_html, edited_at and returns updated row", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: "t1",
        title: "New",
        body_markdown: "Hi",
        body_html: "<p>Hi</p>",
        edited_at: new Date()
      }]
    });
    const { editThread } = await import("@/lib/repositories");
    const result = await editThread({ projectId: "p1", threadId: "t1", title: "New", bodyMarkdown: "Hi" });
    expect(result.title).toBe("New");
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/update discussion_threads set/i);
    expect(sql).toMatch(/edited_at = now\(\)/i);
    expect(sql).toMatch(/where id = \$4 and project_id = \$5/i);
    // params: title, body_markdown, body_html, threadId, projectId
    expect(params[0]).toBe("New");
    expect(params[1]).toBe("Hi");
    expect(typeof params[2]).toBe("string"); // rendered HTML
    expect(params[3]).toBe("t1");
    expect(params[4]).toBe("p1");
  });
});
