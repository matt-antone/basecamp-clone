import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const listArchivedProjectsPaginatedMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  listArchivedProjectsPaginated: listArchivedProjectsPaginatedMock
}));

describe("GET /projects/archived", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    listArchivedProjectsPaginatedMock.mockReset();
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
  });

  it("returns 401 when auth fails", async () => {
    requireUserMock.mockRejectedValue(new Error("auth required"));

    const { GET } = await import("@/app/projects/archived/route");
    const response = await GET(new Request("http://localhost/projects/archived"));

    expect(response.status).toBe(401);
    expect(listArchivedProjectsPaginatedMock).not.toHaveBeenCalled();
  });

  it("returns paginated archived projects for authenticated users", async () => {
    listArchivedProjectsPaginatedMock.mockResolvedValue({
      projects: [{ id: "project-1", name: "Alpha", status: "active" }],
      pagination: { page: 1, limit: 20, total: 1, pages: 1 }
    });

    const { GET } = await import("@/app/projects/archived/route");
    const response = await GET(
      new Request("http://localhost/projects/archived?search=alpha&status=active&page=1&limit=20")
    );

    expect(response.status).toBe(200);
    expect(listArchivedProjectsPaginatedMock).toHaveBeenCalledWith({
      search: "alpha",
      status: "active",
      page: 1,
      limit: 20,
      clientId: null
    });
  });

  it("returns 400 when clientId is invalid", async () => {
    const { GET } = await import("@/app/projects/archived/route");
    const response = await GET(new Request("http://localhost/projects/archived?clientId=invalid"));

    expect(response.status).toBe(400);
    expect(listArchivedProjectsPaginatedMock).not.toHaveBeenCalled();
  });
});
