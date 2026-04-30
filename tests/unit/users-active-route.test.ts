import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const listActiveUsersMock = vi.fn();

vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/repositories", () => ({ listActiveUsers: listActiveUsersMock }));

beforeEach(() => {
  vi.resetModules();
  [requireUserMock, listActiveUsersMock].forEach((m) => m.mockReset());
});

describe("GET /users/active", () => {
  it("returns active users", async () => {
    requireUserMock.mockResolvedValue({ id: "u1" });
    listActiveUsersMock.mockResolvedValue([
      { id: "u1", email: "a@x.com", first_name: "A", last_name: "A" }
    ]);
    const { GET } = await import("@/app/users/active/route");
    const res = await GET(new Request("http://localhost/users/active"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users[0].email).toBe("a@x.com");
  });

  it("returns 401 when auth fails", async () => {
    requireUserMock.mockRejectedValue(new Error("auth required"));
    const { GET } = await import("@/app/users/active/route");
    const res = await GET(new Request("http://localhost/users/active"));
    expect(res.status).toBe(401);
  });
});
