import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const getProjectUpdatedDateMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/repositories", () => ({ getProjectUpdatedDate: getProjectUpdatedDateMock }));

describe("GET /projects/[id]/updated-date", () => {
  beforeEach(() => {
    vi.resetModules();
    requireUserMock.mockReset();
    getProjectUpdatedDateMock.mockReset();
  });

  it("returns the project activity updated date", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    getProjectUpdatedDateMock.mockResolvedValue({ updatedDate: "2026-04-30T12:34:56.789Z" });

    const { GET } = await import("@/app/projects/[id]/updated-date/route");
    const response = await GET(
      new Request("http://localhost/projects/project-1/updated-date", {
        headers: { authorization: "Bearer token" }
      }),
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(200);
    expect(getProjectUpdatedDateMock).toHaveBeenCalledWith("project-1");
    await expect(response.json()).resolves.toEqual({ updatedDate: "2026-04-30T12:34:56.789Z" });
  });

  it("returns 404 when the project is missing", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1" });
    getProjectUpdatedDateMock.mockResolvedValue(null);

    const { GET } = await import("@/app/projects/[id]/updated-date/route");
    const response = await GET(new Request("http://localhost/projects/missing/updated-date"), {
      params: Promise.resolve({ id: "missing" })
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Project not found" });
  });

  it("returns unauthorized for auth failures", async () => {
    requireUserMock.mockRejectedValue(new Error("Invalid auth token"));

    const { GET } = await import("@/app/projects/[id]/updated-date/route");
    const response = await GET(new Request("http://localhost/projects/project-1/updated-date"), {
      params: Promise.resolve({ id: "project-1" })
    });

    expect(response.status).toBe(401);
    expect(getProjectUpdatedDateMock).not.toHaveBeenCalled();
  });
});
