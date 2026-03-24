import { describe, expect, it, beforeEach } from "vitest";

beforeEach(() => {
  process.env.WORKSPACE_DOMAIN = "example.com";
});

describe("workspace-domain auth", () => {
  it("accepts matching domain", async () => {
    const { isAllowedWorkspaceEmail } = await import("@/lib/auth");
    expect(isAllowedWorkspaceEmail("person@example.com")).toBe(true);
  });

  it("rejects non-matching domain", async () => {
    const { isAllowedWorkspaceEmail } = await import("@/lib/auth");
    expect(isAllowedWorkspaceEmail("person@outside.com")).toBe(false);
  });
});
