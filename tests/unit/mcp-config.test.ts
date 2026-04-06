import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const config = readFileSync("supabase/config.toml", "utf8");

describe("Supabase function config", () => {
  it("disables JWT verification for basecamp-mcp", () => {
    expect(config).toContain("[functions.basecamp-mcp]");
    expect(config).toContain("verify_jwt = false");
  });
});
