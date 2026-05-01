import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const getThreadMock = vi.fn();
const editThreadMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  getThread: getThreadMock,
  editThread: editThreadMock
}));

beforeEach(() => {
  vi.resetModules();
  [requireUserMock, getProjectMock, getThreadMock, editThreadMock].forEach((m) => m.mockReset());
});

describe("PATCH /projects/[id]/threads/[threadId]", () => {
  it("returns 200 and updates when caller is the author", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    getThreadMock.mockResolvedValue({ id: "t1", author_user_id: "u1" });
    editThreadMock.mockResolvedValue({ id: "t1", title: "X", body_markdown: "Y", body_html: "<p>Y</p>", edited_at: new Date() });
    const { PATCH } = await import("@/app/projects/[id]/threads/[threadId]/route");
    const res = await PATCH(
      new Request("http://localhost/projects/p1/threads/t1", {
        method: "PATCH",
        body: JSON.stringify({ title: "X", bodyMarkdown: "Y" }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1", threadId: "t1" }) }
    );
    expect(res.status).toBe(200);
    expect(editThreadMock).toHaveBeenCalledWith({ projectId: "p1", threadId: "t1", title: "X", bodyMarkdown: "Y" });
  });

  it("returns 403 when caller is not the author", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    getThreadMock.mockResolvedValue({ id: "t1", author_user_id: "someone-else" });
    const { PATCH } = await import("@/app/projects/[id]/threads/[threadId]/route");
    const res = await PATCH(
      new Request("http://localhost/projects/p1/threads/t1", {
        method: "PATCH",
        body: JSON.stringify({ title: "X", bodyMarkdown: "Y" }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1", threadId: "t1" }) }
    );
    expect(res.status).toBe(403);
    expect(editThreadMock).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid payload", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    getThreadMock.mockResolvedValue({ id: "t1", author_user_id: "u1" });
    const { PATCH } = await import("@/app/projects/[id]/threads/[threadId]/route");
    const res = await PATCH(
      new Request("http://localhost/projects/p1/threads/t1", {
        method: "PATCH",
        body: JSON.stringify({ title: "" }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1", threadId: "t1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when project missing", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue(null);
    const { PATCH } = await import("@/app/projects/[id]/threads/[threadId]/route");
    const res = await PATCH(
      new Request("http://localhost/projects/p1/threads/t1", {
        method: "PATCH",
        body: JSON.stringify({ title: "X", bodyMarkdown: "Y" }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1", threadId: "t1" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when thread missing", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    getThreadMock.mockResolvedValue(null);
    const { PATCH } = await import("@/app/projects/[id]/threads/[threadId]/route");
    const res = await PATCH(
      new Request("http://localhost/projects/p1/threads/t1", {
        method: "PATCH",
        body: JSON.stringify({ title: "X", bodyMarkdown: "Y" }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1", threadId: "t1" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 when auth fails", async () => {
    requireUserMock.mockRejectedValue(new Error("auth required"));
    const { PATCH } = await import("@/app/projects/[id]/threads/[threadId]/route");
    const res = await PATCH(
      new Request("http://localhost/projects/p1/threads/t1", {
        method: "PATCH",
        body: JSON.stringify({ title: "X", bodyMarkdown: "Y" }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1", threadId: "t1" }) }
    );
    expect(res.status).toBe(401);
  });
});
