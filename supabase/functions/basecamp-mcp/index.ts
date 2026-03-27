// supabase/functions/basecamp-mcp/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import { resolveAgent, ensureProfile, createRateLimiter, AuthError } from "./auth.ts";
import { registerTools } from "./tools.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RPM_LIMIT = parseInt(Deno.env.get("MCP_RATE_LIMIT_RPM") ?? "120", 10);

// Module-level singletons — shared across requests in the same isolate
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const rateLimiter = createRateLimiter(RPM_LIMIT);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
};

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // Liveness
  if (url.pathname.endsWith("/healthz")) {
    return new Response("ok", { status: 200, headers: SECURITY_HEADERS });
  }

  // Readiness — verify Supabase is reachable
  if (url.pathname.endsWith("/readyz")) {
    const { error } = await supabase.from("agent_clients").select("client_id").limit(1);
    if (error) return new Response("unavailable", { status: 503, headers: SECURITY_HEADERS });
    return new Response("ok", { status: 200, headers: SECURITY_HEADERS });
  }

  // Auth
  const authHeader = req.headers.get("authorization") ?? "";
  const clientId = req.headers.get("x-mcp-client-id");
  const secret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  let agent;
  try {
    agent = await resolveAgent(supabase, clientId, secret);
  } catch (e) {
    if (e instanceof AuthError) {
      return new Response(e.message, { status: e.status, headers: SECURITY_HEADERS });
    }
    return new Response("Internal error", { status: 500, headers: SECURITY_HEADERS });
  }

  // Rate limit
  if (!rateLimiter.consume(agent.client_id)) {
    return new Response("Too many requests", {
      status: 429,
      headers: { ...SECURITY_HEADERS, "Retry-After": "60" },
    });
  }

  // Auto-create profile on first auth
  await ensureProfile(supabase, agent.client_id);

  // MCP — fresh server per request
  const server = new McpServer({ name: "basecamp-mcp", version: "1.0.0" });
  registerTools(server, supabase, agent);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
});
