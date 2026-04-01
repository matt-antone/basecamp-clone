import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const setProjectUserHoursMock = vi.fn();
const listProjectUserHoursMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  setProjectUserHours: setProjectUserHoursMock,
  listProjectUserHours: listProjectUserHoursMock
}));

describe("PATCH /projects/[id]/my-hours", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    setProjectUserHoursMock.mockReset();
    listProjectUserHoursMock.mockReset();
  });

  it("stores hours only for the authenticated user and returns the refreshed project and user hours", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock
      .mockResolvedValueOnce({ id: "project-1", my_hours: null })
      .mockResolvedValueOnce({ id: "project-1", my_hours: "4.25" });
    setProjectUserHoursMock.mockResolvedValue({ project_id: "project-1", user_id: "user-1", hours: "4.25" });
    listProjectUserHoursMock.mockResolvedValue([
      {
        userId: "user-1",
        firstName: "Pat",
        lastName: "Example",
        email: "person@example.com",
        avatarUrl: null,
        hours: "4.25"
      }
    ]);

    const { PATCH } = await import("@/app/projects/[id]/my-hours/route");
    const response = await PATCH(
      new Request("http://localhost/projects/project-1/my-hours", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ hours: 4.25 })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(200);
    expect(setProjectUserHoursMock).toHaveBeenCalledWith({
      projectId: "project-1",
      userId: "user-1",
      hours: 4.25
    });
    expect(listProjectUserHoursMock).toHaveBeenCalledWith("project-1");
    await expect(response.json()).resolves.toMatchObject({
      project: {
        id: "project-1",
        my_hours: "4.25"
      },
      userHours: [
        {
          userId: "user-1",
          hours: "4.25"
        }
      ]
    });
  });
});
