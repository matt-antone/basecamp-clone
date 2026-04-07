import { describe, it, expect, vi } from "vitest";
import {
  AuthError,
  authenticateAgent,
  createRateLimiter,
  ensureProfile,
  mintAgentJwt,
  parseBearerToken,
  verifyJwt,
} from "../../supabase/functions/basecamp-mcp/auth.ts";

const JWT_CONFIG = {
  secret: "unit-test-secret",
  issuer: "basecamp-mcp",
  audience: "basecamp-mcp",
  clockToleranceSeconds: 30,
} as const;

function mockSupabase(row: object | null, error: object | null = null) {
  const single = vi.fn().mockResolvedValue({ data: row, error });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn().mockReturnValue({ select, upsert });
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

describe("parseBearerToken", () => {
  it("extracts a bearer token", () => {
    expect(parseBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("returns null for non-bearer headers", () => {
    expect(parseBearerToken("Basic abc")).toBe(null);
    expect(parseBearerToken(null)).toBe(null);
  });
});

describe("verifyJwt", () => {
  it("accepts a valid token", async () => {
    const token = await mintAgentJwt({ client_id: "mcp-test-client" }, JWT_CONFIG);
    const claims = await verifyJwt(token, JWT_CONFIG);
    expect(claims.sub).toBe("mcp-test-client");
    expect(claims.iss).toBe(JWT_CONFIG.issuer);
    expect(claims.aud).toBe(JWT_CONFIG.audience);
  });

  it("rejects malformed tokens", async () => {
    await expect(verifyJwt("not-a-jwt", JWT_CONFIG)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects invalid signatures", async () => {
    const token = await mintAgentJwt({ client_id: "mcp-test-client" }, JWT_CONFIG);
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    await expect(verifyJwt(tampered, JWT_CONFIG)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects expired tokens", async () => {
    const token = await mintAgentJwt({ client_id: "mcp-test-client", expiresInSeconds: -60 }, JWT_CONFIG);
    await expect(verifyJwt(token, JWT_CONFIG)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects wrong issuer", async () => {
    const token = await mintAgentJwt({ client_id: "mcp-test-client" }, { ...JWT_CONFIG, issuer: "other" });
    await expect(verifyJwt(token, JWT_CONFIG)).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects wrong audience", async () => {
    const token = await mintAgentJwt({ client_id: "mcp-test-client" }, { ...JWT_CONFIG, audience: "other" });
    await expect(verifyJwt(token, JWT_CONFIG)).rejects.toBeInstanceOf(AuthError);
  });
});

describe("authenticateAgent", () => {
  it("throws AuthError when token is missing", async () => {
    await expect(authenticateAgent({} as any, null, JWT_CONFIG)).rejects.toBeInstanceOf(AuthError);
  });

  it("throws AuthError when agent not found in DB", async () => {
    const token = await mintAgentJwt({ client_id: "mcp-test-client" }, JWT_CONFIG);
    const supabase = mockSupabase(null, { message: "not found" });
    await expect(authenticateAgent(supabase, token, JWT_CONFIG)).rejects.toBeInstanceOf(AuthError);
  });

  it("throws AuthError when agent is disabled", async () => {
    const token = await mintAgentJwt({ client_id: "mcp-test-client" }, JWT_CONFIG);
    const supabase = mockSupabase({ client_id: "mcp-test-client", role: "agent", disabled: true });
    await expect(authenticateAgent(supabase, token, JWT_CONFIG)).rejects.toBeInstanceOf(AuthError);
  });

  it("returns identity when token and DB row are valid", async () => {
    const token = await mintAgentJwt({ client_id: "mcp-test-client" }, JWT_CONFIG);
    const supabase = mockSupabase({ client_id: "mcp-test-client", role: "agent", disabled: false });
    const identity = await authenticateAgent(supabase, token, JWT_CONFIG);
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
