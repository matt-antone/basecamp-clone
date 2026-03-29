// tests/unit/mcp-write-tools.test.ts
import { describe, it, expect, vi } from "vitest";
import * as db from "../../supabase/functions/basecamp-mcp/db.ts";
import { registerTools } from "../../supabase/functions/basecamp-mcp/tools.ts";

function mockServer() {
  const handlers = new Map<string, Function>();
  return {
    tool: vi.fn((name: string, _desc: string, _schema: any, handler: Function) => {
      handlers.set(name, handler);
    }),
    call: (name: string, params: any) => handlers.get(name)!(params),
  };
}

const agent = { client_id: "mcp-test-client", role: "agent" };

describe("create_project", () => {
  it("creates a project and stamps author_user_id from agent", async () => {
    const created = { id: "p-1", name: "New Project", created_by: "mcp-test-client" };
    const spy = vi.spyOn(db, "createProject").mockResolvedValue(created as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("create_project", { name: "New Project" });
    expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ name: "New Project" }), "mcp-test-client");
    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe("New Project");
  });
});

describe("update_project", () => {
  it("returns updated project", async () => {
    vi.spyOn(db, "updateProject").mockResolvedValue({ id: "p-1", name: "Renamed" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("update_project", { project_id: "p-1", name: "Renamed" });
    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe("Renamed");
  });

  it("returns error when project not found", async () => {
    vi.spyOn(db, "updateProject").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("update_project", { project_id: "bad-id" });
    expect(result.isError).toBe(true);
  });
});

describe("create_thread", () => {
  it("converts markdown to HTML before saving", async () => {
    const spy = vi.spyOn(db, "createThread").mockResolvedValue({ id: "t-1" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("create_thread", {
      project_id: "p-1",
      title: "Hello",
      body_markdown: "**bold**",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body_markdown: "**bold**", body_html: expect.stringContaining("<strong>") }),
      "mcp-test-client"
    );
  });
});

describe("update_thread", () => {
  it("converts updated markdown to HTML", async () => {
    const spy = vi.spyOn(db, "updateThread").mockResolvedValue({ id: "t-1" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("update_thread", { thread_id: "t-1", body_markdown: "_italic_" });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      "t-1",
      expect.objectContaining({ body_html: expect.stringContaining("<em>") })
    );
  });
});

describe("create_comment", () => {
  it("looks up project_id from thread before inserting", async () => {
    vi.spyOn(db, "getThread").mockResolvedValue({
      thread: { id: "t-1", project_id: "proj-1" },
      comments: [],
      files: [],
    } as any);
    const spy = vi.spyOn(db, "createComment").mockResolvedValue({ id: "c-1" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("create_comment", { thread_id: "t-1", body_markdown: "hi" });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ project_id: "proj-1" }),
      "mcp-test-client"
    );
  });
});

describe("update_comment", () => {
  it("returns error when comment not found", async () => {
    vi.spyOn(db, "updateComment").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("update_comment", {
      comment_id: "bad",
      body_markdown: "new content",
    });
    expect(result.isError).toBe(true);
  });
});
