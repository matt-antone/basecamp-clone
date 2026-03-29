// tests/unit/mcp-read-tools.test.ts
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

describe("list_projects", () => {
  it("returns projects as JSON text content", async () => {
    vi.spyOn(db, "listProjects").mockResolvedValue([
      { id: "proj-1", name: "Test Project", slug: "test-project", status: "new", created_at: "2026-01-01" },
    ] as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("list_projects", {});
    expect(result.content[0].type).toBe("text");
    const data = JSON.parse(result.content[0].text);
    expect(data[0].name).toBe("Test Project");
  });
});

describe("get_project", () => {
  it("returns project detail", async () => {
    vi.spyOn(db, "getProject").mockResolvedValue({
      project: { id: "proj-1", name: "Test" },
      threads: [],
      file_count: 3,
    } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_project", { project_id: "proj-1" });
    const data = JSON.parse(result.content[0].text);
    expect(data.file_count).toBe(3);
  });

  it("returns error content when project not found", async () => {
    vi.spyOn(db, "getProject").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_project", { project_id: "bad-id" });
    expect(result.isError).toBe(true);
  });
});

describe("get_thread", () => {
  it("returns thread with comments and files", async () => {
    vi.spyOn(db, "getThread").mockResolvedValue({
      thread: { id: "t-1", title: "My Thread" },
      comments: [{ id: "c-1", body_markdown: "hello", files: [] }],
      files: [],
    } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_thread", { thread_id: "t-1" });
    const data = JSON.parse(result.content[0].text);
    expect(data.thread.title).toBe("My Thread");
    expect(data.comments).toHaveLength(1);
  });

  it("returns error when thread not found", async () => {
    vi.spyOn(db, "getThread").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_thread", { thread_id: "bad" });
    expect(result.isError).toBe(true);
  });
});

describe("list_files", () => {
  it("returns files for a project", async () => {
    vi.spyOn(db, "listFiles").mockResolvedValue([
      { id: "f-1", filename: "doc.pdf", mime_type: "application/pdf" },
    ] as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("list_files", { project_id: "proj-1" });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].filename).toBe("doc.pdf");
  });
});

describe("get_file", () => {
  it("returns file metadata", async () => {
    vi.spyOn(db, "getFile").mockResolvedValue({ id: "f-1", filename: "doc.pdf" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_file", { file_id: "f-1" });
    const data = JSON.parse(result.content[0].text);
    expect(data.filename).toBe("doc.pdf");
  });

  it("returns error when file not found", async () => {
    vi.spyOn(db, "getFile").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_file", { file_id: "bad" });
    expect(result.isError).toBe(true);
  });
});

describe("search_content", () => {
  it("returns search results", async () => {
    vi.spyOn(db, "searchContent").mockResolvedValue([
      { result_type: "thread", result_id: "t-1", excerpt: "hello world" },
    ] as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("search_content", { query: "hello" });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].result_type).toBe("thread");
  });
});
