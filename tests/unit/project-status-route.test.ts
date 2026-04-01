import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectMock = vi.fn();
const setProjectStatusMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  getProject: getProjectMock,
  setProjectStatus: setProjectStatusMock
}));

describe("POST /projects/[id]/status", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getProjectMock.mockReset();
    setProjectStatusMock.mockReset();
  });

  it("allows sending a completed active project to billing", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      status: "complete",
      archived: false
    });
    setProjectStatusMock.mockResolvedValue({
      id: "project-1",
      status: "billing",
      archived: false
    });

    const { POST } = await import("@/app/projects/[id]/status/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/status", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ status: "billing" })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(200);
    expect(getProjectMock).toHaveBeenCalledWith("project-1", "user-1");
    expect(setProjectStatusMock).toHaveBeenCalledWith("project-1", "billing");
  });

  it("rejects billing unless the current status is complete", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      status: "in_progress",
      archived: false
    });

    const { POST } = await import("@/app/projects/[id]/status/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/status", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ status: "billing" })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(400);
    expect(setProjectStatusMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/billing/i)
    });
  });

  it("rejects billing for archived projects", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      status: "complete",
      archived: true
    });

    const { POST } = await import("@/app/projects/[id]/status/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/status", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ status: "billing" })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(400);
    expect(setProjectStatusMock).not.toHaveBeenCalled();
  });

  it("allows reopening billing back to in progress", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      status: "billing",
      archived: false
    });
    setProjectStatusMock.mockResolvedValue({
      id: "project-1",
      status: "in_progress",
      archived: false
    });

    const { POST } = await import("@/app/projects/[id]/status/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/status", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ status: "in_progress" })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(200);
    expect(setProjectStatusMock).toHaveBeenCalledWith("project-1", "in_progress");
  });

  it("rejects other workflow moves from billing", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      status: "billing",
      archived: false
    });

    const { POST } = await import("@/app/projects/[id]/status/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/status", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ status: "blocked" })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(400);
    expect(setProjectStatusMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/in progress|billing/i)
    });
  });

  it("allows normal board moves when the project is not in billing", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue({
      id: "project-1",
      status: "blocked",
      archived: false
    });
    setProjectStatusMock.mockResolvedValue({
      id: "project-1",
      status: "complete",
      archived: false
    });

    const { POST } = await import("@/app/projects/[id]/status/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/status", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ status: "complete" })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(200);
    expect(setProjectStatusMock).toHaveBeenCalledWith("project-1", "complete");
  });

  it("returns not found when the project does not exist", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectMock.mockResolvedValue(null);

    const { POST } = await import("@/app/projects/[id]/status/route");
    const response = await POST(
      new Request("http://localhost/projects/project-1/status", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json"
        },
        body: JSON.stringify({ status: "complete" })
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(404);
    expect(setProjectStatusMock).not.toHaveBeenCalled();
  });
});
