// tests/unit/mcp-auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import {
  AuthError,
  createRateLimiter,
  resolveAgent,
  ensureProfile,
} from "../../supabase/functions/basecamp-mcp/auth.ts";

function mockSupabase(row: object | null, error: object | null = null) {
  const single = vi.fn().mockResolvedValue({ data: row, error });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select, upsert: vi.fn().mockResolvedValue({ error: null }) });
  return { from } as any;
}

describe("createRateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = createRateLimiter(3);
    expect(limiter.consume("agent1")).toBe(true);
    expect(limiter.consume("agent1")).toBe(true);
    expect(limiter.consume("agent1")).toBe(true);
  });

  it("blocks requests over the limit", () => {
    const limiter = createRateLimiter(2);
    limiter.consume("agent1");
    limiter.consume("agent1");
    expect(limiter.consume("agent1")).toBe(false);
  });

  it("tracks limits per client_id independently", () => {
    const limiter = createRateLimiter(1);
    expect(limiter.consume("agent1")).toBe(true);
    expect(limiter.consume("agent2")).toBe(true);
    expect(limiter.consume("agent1")).toBe(false);
  });
});

describe("resolveAgent", () => {
  it("throws AuthError when clientId is null", async () => {
    await expect(resolveAgent({} as any, null, "secret"))
      .rejects.toThrow(AuthError);
  });

  it("throws AuthError when secret is null", async () => {
    await expect(resolveAgent({} as any, "mcp-test-client", null))
      .rejects.toThrow(AuthError);
  });

  it("throws AuthError when agent not found in DB", async () => {
    const supabase = mockSupabase(null, { message: "not found" });
    await expect(resolveAgent(supabase, "mcp-test-client", "secret"))
      .rejects.toThrow(AuthError);
  });

  it("throws AuthError when agent is disabled", async () => {
    const hash = await bcrypt.hash("secret", 10);
    const supabase = mockSupabase({ client_id: "mcp-test-client", secret_hash: hash, role: "agent", disabled: true });
    await expect(resolveAgent(supabase, "mcp-test-client", "secret"))
      .rejects.toThrow(AuthError);
  });

  it("throws AuthError when secret is wrong", async () => {
    const hash = await bcrypt.hash("correct", 10);
    const supabase = mockSupabase({ client_id: "mcp-test-client", secret_hash: hash, role: "agent", disabled: false });
    await expect(resolveAgent(supabase, "mcp-test-client", "wrong"))
      .rejects.toThrow(AuthError);
  });

  it("returns identity when credentials are valid", async () => {
    const hash = await bcrypt.hash("secret", 10);
    const supabase = mockSupabase({ client_id: "mcp-test-client", secret_hash: hash, role: "agent", disabled: false });
    const identity = await resolveAgent(supabase, "mcp-test-client", "secret");
    expect(identity).toEqual({ client_id: "mcp-test-client", role: "agent" });
  });
});

describe("ensureProfile", () => {
  it("upserts a profile row with ignoreDuplicates", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ upsert });
    await ensureProfile({ from } as any, "mcp-test-client");
    expect(from).toHaveBeenCalledWith("agent_profiles");
    expect(upsert).toHaveBeenCalledWith(
      { client_id: "mcp-test-client" },
      expect.objectContaining({ ignoreDuplicates: true })
    );
  });
});
