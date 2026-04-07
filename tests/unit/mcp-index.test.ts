import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const index = readFileSync("supabase/functions/basecamp-mcp/index.ts", "utf8");

describe("basecamp-mcp edge function entrypoint", () => {
  it("uses the Web Standard MCP transport in Deno runtime", () => {
    expect(index).toContain("WebStandardStreamableHTTPServerTransport");
    expect(index).toContain("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
    expect(index).not.toContain("@modelcontextprotocol/sdk/server/streamableHttp.js");
  });

  it("fails gracefully when Supabase env vars are missing", () => {
    expect(index).toContain("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    expect(index).not.toContain("const SUPABASE_URL = Deno.env.get(\"SUPABASE_URL\")!");
    expect(index).not.toContain("const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(\"SUPABASE_SERVICE_ROLE_KEY\")!");
  });

  it("uses JWT auth config and does not depend on x-mcp-client-id", () => {
    expect(index).toContain("PM_SERVER_JWT_SECRET");
    expect(index).toContain("parseBearerToken");
    expect(index).not.toContain("x-mcp-client-id");
  });
});
