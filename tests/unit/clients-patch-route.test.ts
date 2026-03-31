import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const updateClientNameMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/repositories", () => ({
  updateClientName: updateClientNameMock
}));

describe("PATCH /clients/[id]", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    updateClientNameMock.mockReset();
  });

  it("updates client name and returns the row", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    updateClientNameMock.mockResolvedValue({
      id: "client-uuid",
      name: "Acme Updated",
      code: "ACME"
    });

    const { PATCH } = await import("@/app/clients/[id]/route");
    const response = await PATCH(
      new Request("http://localhost/clients/client-uuid", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: "Acme Updated" })
      }),
      { params: Promise.resolve({ id: "client-uuid" }) }
    );

    expect(response.status).toBe(200);
    expect(updateClientNameMock).toHaveBeenCalledWith("client-uuid", "Acme Updated");
    await expect(response.json()).resolves.toMatchObject({
      client: { name: "Acme Updated", code: "ACME" }
    });
  });

  it("returns 404 when client does not exist", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    updateClientNameMock.mockResolvedValue(null);

    const { PATCH } = await import("@/app/clients/[id]/route");
    const response = await PATCH(
      new Request("http://localhost/clients/missing", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: "X" })
      }),
      { params: Promise.resolve({ id: "missing" }) }
    );

    expect(response.status).toBe(404);
  });

  it("returns 400 for empty name", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });

    const { PATCH } = await import("@/app/clients/[id]/route");
    const response = await PATCH(
      new Request("http://localhost/clients/client-uuid", {
        method: "PATCH",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: "" })
      }),
      { params: Promise.resolve({ id: "client-uuid" }) }
    );

    expect(response.status).toBe(400);
    expect(updateClientNameMock).not.toHaveBeenCalled();
  });
});
