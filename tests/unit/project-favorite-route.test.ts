import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const addProjectFavoriteMock = vi.fn();
const removeProjectFavoriteMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  addProjectFavorite: addProjectFavoriteMock,
  removeProjectFavorite: removeProjectFavoriteMock
}));

const VALID_ID = "11111111-1111-1111-8111-111111111111";

function favoriteRequest(method: "POST" | "DELETE", id = VALID_ID) {
  return new Request(`http://localhost/projects/${id}/favorite`, {
    method,
    headers: { authorization: "Bearer token" }
  });
}

describe("/projects/[id]/favorite", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    addProjectFavoriteMock.mockReset();
    addProjectFavoriteMock.mockResolvedValue(undefined);
    removeProjectFavoriteMock.mockReset();
    removeProjectFavoriteMock.mockResolvedValue(undefined);
  });

  it("POST favorites the project for the authed user", async () => {
    const { POST } = await import("@/app/projects/[id]/favorite/route");
    const response = await POST(favoriteRequest("POST"), { params: Promise.resolve({ id: VALID_ID }) });

    expect(response.status).toBe(200);
    expect(addProjectFavoriteMock).toHaveBeenCalledWith("user-1", VALID_ID);
  });

  it("DELETE unfavorites the project for the authed user", async () => {
    const { DELETE } = await import("@/app/projects/[id]/favorite/route");
    const response = await DELETE(favoriteRequest("DELETE"), { params: Promise.resolve({ id: VALID_ID }) });

    expect(response.status).toBe(200);
    expect(removeProjectFavoriteMock).toHaveBeenCalledWith("user-1", VALID_ID);
  });

  it("rejects a non-uuid project id with 400", async () => {
    const { POST } = await import("@/app/projects/[id]/favorite/route");
    const response = await POST(favoriteRequest("POST", "not-a-uuid"), {
      params: Promise.resolve({ id: "not-a-uuid" })
    });

    expect(response.status).toBe(400);
    expect(addProjectFavoriteMock).not.toHaveBeenCalled();
  });

  it("returns 401 when auth fails", async () => {
    requireUserMock.mockRejectedValue(new Error("auth missing"));

    const { POST } = await import("@/app/projects/[id]/favorite/route");
    const response = await POST(favoriteRequest("POST"), { params: Promise.resolve({ id: VALID_ID }) });

    expect(response.status).toBe(401);
    expect(addProjectFavoriteMock).not.toHaveBeenCalled();
  });
});
