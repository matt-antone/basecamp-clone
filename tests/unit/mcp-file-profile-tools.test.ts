// tests/unit/mcp-file-profile-tools.test.ts
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

const agent = { client_id: "claude", role: "agent" };

describe("create_file", () => {
  it("registers file metadata with agent as uploader", async () => {
    const spy = vi.spyOn(db, "createFile").mockResolvedValue({ id: "f-1" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const params = {
      project_id: "p-1",
      filename: "doc.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      dropbox_file_id: "id:abc",
      dropbox_path: "/test-uploads/p-1/doc.pdf",
      checksum: "sha256:abc",
    };
    await server.call("create_file", params);
    expect(spy).toHaveBeenCalledWith(expect.anything(), params, "claude");
  });

  it("accepts optional thread_id and comment_id", async () => {
    const spy = vi.spyOn(db, "createFile").mockResolvedValue({ id: "f-2" } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    await server.call("create_file", {
      project_id: "p-1",
      filename: "img.png",
      mime_type: "image/png",
      size_bytes: 500,
      dropbox_file_id: "id:xyz",
      dropbox_path: "/test-uploads/p-1/img.png",
      checksum: "sha256:xyz",
      thread_id: "t-1",
      comment_id: "c-1",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ thread_id: "t-1", comment_id: "c-1" }),
      "claude"
    );
  });
});

describe("get_my_profile", () => {
  it("returns the calling agent's profile", async () => {
    vi.spyOn(db, "getProfile").mockResolvedValue({
      client_id: "claude",
      name: "Claude",
      bio: "AI assistant",
      preferences: {},
    } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_my_profile", {});
    const data = JSON.parse(result.content[0].text);
    expect(data.client_id).toBe("claude");
    expect(data.name).toBe("Claude");
  });

  it("returns error when profile not found", async () => {
    vi.spyOn(db, "getProfile").mockResolvedValue(null);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("get_my_profile", {});
    expect(result.isError).toBe(true);
  });
});

describe("update_my_profile", () => {
  it("updates agent profile with provided fields", async () => {
    const spy = vi.spyOn(db, "updateProfile").mockResolvedValue({
      client_id: "claude",
      name: "Claude Agent",
    } as any);
    const server = mockServer();
    registerTools(server as any, {} as any, agent);
    const result = await server.call("update_my_profile", { name: "Claude Agent" });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      "claude",
      expect.objectContaining({ name: "Claude Agent" })
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe("Claude Agent");
  });
});
