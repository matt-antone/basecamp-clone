import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const listProjectMembersMock = vi.fn();
const addProjectMemberMock = vi.fn();
const removeProjectMemberMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  listProjectMembers: listProjectMembersMock,
  addProjectMember: addProjectMemberMock,
  removeProjectMember: removeProjectMemberMock
}));

beforeEach(() => {
  vi.resetModules();
  [requireUserMock, getProjectMock, listProjectMembersMock, addProjectMemberMock, removeProjectMemberMock].forEach((m) => m.mockReset());
});

describe("GET /projects/[id]/members", () => {
  it("returns the member list", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    listProjectMembersMock.mockResolvedValue([
      { user_id: "u1", email: "a@x.com", first_name: "A", last_name: "A", added_at: new Date() }
    ]);
    const { GET } = await import("@/app/projects/[id]/members/route");
    const res = await GET(new Request("http://localhost/projects/p1/members"), {
      params: Promise.resolve({ id: "p1" })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(1);
  });

  it("returns 404 when project not found", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue(null);
    const { GET } = await import("@/app/projects/[id]/members/route");
    const res = await GET(new Request("http://localhost/projects/p1/members"), {
      params: Promise.resolve({ id: "p1" })
    });
    expect(res.status).toBe(404);
  });

  it("returns 401 when auth fails", async () => {
    requireUserMock.mockRejectedValue(new Error("auth required"));
    const { GET } = await import("@/app/projects/[id]/members/route");
    const res = await GET(new Request("http://localhost/projects/p1/members"), {
      params: Promise.resolve({ id: "p1" })
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /projects/[id]/members", () => {
  it("adds a member and returns 201", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    addProjectMemberMock.mockResolvedValue(undefined);
    const { POST } = await import("@/app/projects/[id]/members/route");
    const res = await POST(
      new Request("http://localhost/projects/p1/members", {
        method: "POST",
        body: JSON.stringify({ userId: "u2" }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1" }) }
    );
    expect(res.status).toBe(201);
    expect(addProjectMemberMock).toHaveBeenCalledWith("p1", "u2");
  });

  it("400 on invalid payload", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    const { POST } = await import("@/app/projects/[id]/members/route");
    const res = await POST(
      new Request("http://localhost/projects/p1/members", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("404 when project not found", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue(null);
    const { POST } = await import("@/app/projects/[id]/members/route");
    const res = await POST(
      new Request("http://localhost/projects/p1/members", {
        method: "POST",
        body: JSON.stringify({ userId: "u2" }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 when auth fails", async () => {
    requireUserMock.mockRejectedValue(new Error("auth required"));
    const { POST } = await import("@/app/projects/[id]/members/route");
    const res = await POST(
      new Request("http://localhost/projects/p1/members", {
        method: "POST",
        body: JSON.stringify({ userId: "u2" }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "p1" }) }
    );
    expect(res.status).toBe(401);
  });
});
