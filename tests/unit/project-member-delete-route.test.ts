import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const removeProjectMemberMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  removeProjectMember: removeProjectMemberMock
}));

beforeEach(() => {
  vi.resetModules();
  [requireUserMock, getProjectMock, removeProjectMemberMock].forEach((m) => m.mockReset());
});

describe("DELETE /projects/[id]/members/[userId]", () => {
  it("removes a member and returns 200", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    removeProjectMemberMock.mockResolvedValue(undefined);
    const { DELETE } = await import("@/app/projects/[id]/members/[userId]/route");
    const res = await DELETE(
      new Request("http://localhost/projects/p1/members/u2", { method: "DELETE" }),
      { params: Promise.resolve({ id: "p1", userId: "u2" }) }
    );
    expect(res.status).toBe(200);
    expect(removeProjectMemberMock).toHaveBeenCalledWith("p1", "u2");
  });

  it("returns 400 if removing would leave zero members", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue({ id: "p1" });
    removeProjectMemberMock.mockRejectedValue(new Error("Cannot remove the last member of a project"));
    const { DELETE } = await import("@/app/projects/[id]/members/[userId]/route");
    const res = await DELETE(
      new Request("http://localhost/projects/p1/members/u2", { method: "DELETE" }),
      { params: Promise.resolve({ id: "p1", userId: "u2" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when project not found", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    getProjectMock.mockResolvedValue(null);
    const { DELETE } = await import("@/app/projects/[id]/members/[userId]/route");
    const res = await DELETE(
      new Request("http://localhost/projects/p1/members/u2", { method: "DELETE" }),
      { params: Promise.resolve({ id: "p1", userId: "u2" }) }
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 when auth fails", async () => {
    requireUserMock.mockRejectedValue(new Error("auth required"));
    const { DELETE } = await import("@/app/projects/[id]/members/[userId]/route");
    const res = await DELETE(
      new Request("http://localhost/projects/p1/members/u2", { method: "DELETE" }),
      { params: Promise.resolve({ id: "p1", userId: "u2" }) }
    );
    expect(res.status).toBe(401);
  });
});
