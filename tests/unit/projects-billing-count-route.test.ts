import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const countBillingStageProjectsMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/billing-stage-count", () => ({
  countBillingStageProjects: countBillingStageProjectsMock
}));

describe("GET /projects/billing-count", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue({ id: "user-1", email: "person@example.com" });
    countBillingStageProjectsMock.mockReset();
  });

  it("returns 401 when auth fails", async () => {
    requireUserMock.mockRejectedValue(new Error("auth missing"));

    const { GET } = await import("@/app/projects/billing-count/route");
    const response = await GET(new Request("http://localhost/projects/billing-count"));

    expect(response.status).toBe(401);
    expect(countBillingStageProjectsMock).not.toHaveBeenCalled();
  });

  it("returns count from countBillingStageProjects", async () => {
    countBillingStageProjectsMock.mockResolvedValue(3);

    const { GET } = await import("@/app/projects/billing-count/route");
    const response = await GET(new Request("http://localhost/projects/billing-count"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ count: 3 });
    expect(countBillingStageProjectsMock).toHaveBeenCalledWith({ clientId: null, search: undefined });
  });

  it("passes clientId and search when present", async () => {
    countBillingStageProjectsMock.mockResolvedValue(1);

    const { GET } = await import("@/app/projects/billing-count/route");
    const response = await GET(
      new Request(
        "http://localhost/projects/billing-count?clientId=11111111-1111-1111-1111-111111111111&search=alpha"
      )
    );

    expect(response.status).toBe(200);
    expect(countBillingStageProjectsMock).toHaveBeenCalledWith({
      clientId: "11111111-1111-1111-1111-111111111111",
      search: "alpha"
    });
  });

  it("returns 400 when clientId is invalid", async () => {
    const { GET } = await import("@/app/projects/billing-count/route");
    const response = await GET(new Request("http://localhost/projects/billing-count?clientId=bad"));

    expect(response.status).toBe(400);
    expect(countBillingStageProjectsMock).not.toHaveBeenCalled();
  });
});
