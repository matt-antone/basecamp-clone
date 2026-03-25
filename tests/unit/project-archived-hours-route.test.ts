import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const listProjectUserHoursMock = vi.fn();
const setProjectUserHoursMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  listProjectUserHours: listProjectUserHoursMock,
  setProjectUserHours: setProjectUserHoursMock
}));

describe("PATCH /projects/[id]/archived-hours", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    listProjectUserHoursMock.mockReset();
    setProjectUserHoursMock.mockReset();
  });

  it("stores hours for the requested user on archived projects and returns refreshed data", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock
      .mockResolvedValueOnce({ id: "project-1", archived: true })
      .mockResolvedValueOnce({ id: "project-1", archived: true });
    setProjectUserHoursMock.mockResolvedValue({ project_id: "project-1", user_id: "user-2", hours: "7.5" });
    listProjectUserHoursMock.mockResolvedValue([
      {
        userId: "user-2",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
        avatarUrl: null,
        hours: "7.5"
      }
    ]);

    const { PATCH } = await import("@/app/projects/[id]/archived-hours/route");
    const response = await PATCH(
      new Request("http://localhost/projects/project-1/archived-hours", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ userId: "user-2", hours: 7.5 })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(200);
    expect(setProjectUserHoursMock).toHaveBeenCalledWith({
      projectId: "project-1",
      userId: "user-2",
      hours: 7.5
    });
    await expect(response.json()).resolves.toMatchObject({
      project: { id: "project-1", archived: true },
      userHours: [{ userId: "user-2", hours: "7.5" }]
    });
  });

  it("rejects archived-hour edits when the project is still active", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({ id: "project-1", archived: false });

    const { PATCH } = await import("@/app/projects/[id]/archived-hours/route");
    const response = await PATCH(
      new Request("http://localhost/projects/project-1/archived-hours", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ userId: "user-2", hours: 7.5 })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Archived hours can only be edited on archived projects"
    });
    expect(setProjectUserHoursMock).not.toHaveBeenCalled();
  });
});
