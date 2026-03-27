// tests/integration/mcp-smoke.test.ts
import { describe, it, expect, beforeAll } from "vitest";

// Skip entire suite when smoke env vars are absent
const SMOKE_URL = process.env.MCP_SMOKE_URL;
const CLIENT_ID = process.env.MCP_SMOKE_CLIENT_ID;
const SECRET = process.env.MCP_SMOKE_SECRET;

describe.skipIf(!SMOKE_URL || !CLIENT_ID || !SECRET)("MCP smoke tests (live)", () => {
  async function mcpCall(method: string, params: Record<string, unknown>) {
    const res = await fetch(SMOKE_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        Authorization: `Bearer ${SECRET}`,
        "x-mcp-client-id": CLIENT_ID!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });
    return res.json();
  }

  it("GET /healthz returns 200", async () => {
    const res = await fetch(`${SMOKE_URL}/healthz`);
    expect(res.status).toBe(200);
  });

  it("GET /readyz returns 200", async () => {
    const res = await fetch(`${SMOKE_URL}/readyz`);
    expect(res.status).toBe(200);
  });

  it("rejects bad credentials with 401", async () => {
    const res = await fetch(SMOKE_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer bad-secret",
        "x-mcp-client-id": CLIENT_ID!,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it("tools/list returns all 15 tools", async () => {
    const response = await mcpCall("tools/list", {});
    expect(response.result?.tools).toHaveLength(15);
    const names = response.result.tools.map((t: any) => t.name);
    expect(names).toContain("list_projects");
    expect(names).toContain("get_my_profile");
    expect(names).toContain("create_file");
  });

  it("list_projects returns array", async () => {
    const response = await mcpCall("tools/call", {
      name: "list_projects",
      arguments: {},
    });
    const data = JSON.parse(response.result?.content?.[0]?.text ?? "null");
    expect(Array.isArray(data)).toBe(true);
  });
});
