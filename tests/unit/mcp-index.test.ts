import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const index = readFileSync("supabase/functions/basecamp-mcp/index.ts", "utf8");

describe("basecamp-mcp edge function entrypoint", () => {
  it("uses the Web Standard MCP transport in Deno runtime", () => {
    expect(index).toContain("StreamableHTTPServerTransport");
    expect(index).toContain("@modelcontextprotocol/sdk/server/streamableHttp.js");
    expect(index).not.toContain("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
  });

  it("fails gracefully when Supabase env vars are missing", () => {
    expect(index).toContain("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    expect(index).not.toContain("const SUPABASE_URL = Deno.env.get(\"SUPABASE_URL\")!");
    expect(index).not.toContain("const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(\"SUPABASE_SERVICE_ROLE_KEY\")!");
  });
});
