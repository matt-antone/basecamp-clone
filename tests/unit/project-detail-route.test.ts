import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const listProjectUserHoursMock = vi.fn();
const updateProjectMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  listProjectUserHours: listProjectUserHoursMock,
  updateProject: updateProjectMock
}));

describe("/projects/[id] route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    listProjectUserHoursMock.mockReset();
    updateProjectMock.mockReset();
  });

  it("returns project detail with userHours", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1", deadline: "2026-05-30" });
    listProjectUserHoursMock.mockResolvedValue([
      {
        userId: "user-1",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
        avatarUrl: null,
        hours: "5.5"
      }
    ]);

    const { GET } = await import("@/app/projects/[id]/route");
    const response = await GET(new Request("http://localhost/projects/project-1", { headers: { authorization: "Bearer token" } }), {
      params: Promise.resolve({ id: "project-1" })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      project: { id: "project-1", deadline: "2026-05-30" },
      userHours: [{ userId: "user-1", hours: "5.5" }]
    });
  });

  it("passes deadline through on patch", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    updateProjectMock.mockResolvedValue({ id: "project-1", deadline: "2026-05-30" });

    const { PATCH } = await import("@/app/projects/[id]/route");
    const response = await PATCH(
      new Request("http://localhost/projects/project-1", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Website Refresh",
          description: "Updated brief",
          clientId: "11111111-1111-1111-1111-111111111111",
          deadline: "2026-05-30",
          tags: ["ops"],
          requestor: "Jane Producer"
        })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(200);
    expect(updateProjectMock).toHaveBeenCalledWith({
      id: "project-1",
      name: "Website Refresh",
      description: "Updated brief",
      clientId: "11111111-1111-1111-1111-111111111111",
      deadline: "2026-05-30",
      tags: ["ops"],
      requestor: "Jane Producer"
    });
  });
});
