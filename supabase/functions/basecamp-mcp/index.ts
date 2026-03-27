// supabase/functions/basecamp-mcp/index.ts
import { z } from "zod";
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

// ─── Minimal Zod → JSON Schema converter ─────────────────────────────────────
// Handles exactly the types used in tools.ts. Works with both Zod v3 and v4
// via _def introspection — avoids any Zod-version-specific utility functions.

// deno-lint-ignore no-explicit-any
function inferPropertySchema(field: z.ZodTypeAny): Record<string, unknown> {
  // deno-lint-ignore no-explicit-any
  const def = (field as any)._def;
  if (!def?.typeName) return {};

  switch (def.typeName) {
    case "ZodString": {
      const checks: Array<{ kind: string; value?: number }> = def.checks ?? [];
      const prop: Record<string, unknown> = { type: "string" };
      for (const c of checks) {
        if (c.kind === "uuid") prop.format = "uuid";
        if (c.kind === "url") prop.format = "uri";
        if (c.kind === "date") prop.format = "date";
        if (c.kind === "min" && c.value != null) prop.minLength = c.value;
      }
      return prop;
    }
    case "ZodNumber": {
      const checks: Array<{ kind: string; value?: number; inclusive?: boolean }> =
        def.checks ?? [];
      const prop: Record<string, unknown> = { type: "number" };
      for (const c of checks) {
        if (c.kind === "int") prop.type = "integer";
        if (c.kind === "min" && c.value != null)
          prop.minimum = c.inclusive === false ? c.value + 1 : c.value;
        if (c.kind === "max" && c.value != null)
          prop.maximum = c.inclusive === false ? c.value - 1 : c.value;
      }
      return prop;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum": {
      // deno-lint-ignore no-explicit-any
      const vals = (def as any).values;
      const enumArr = Array.isArray(vals) ? vals : Object.values(vals ?? {});
      return { type: "string", enum: enumArr };
    }
    case "ZodRecord":
      return { type: "object" };
    default:
      return {};
  }
}

function shapeToInputSchema(shape: Record<string, z.ZodTypeAny>): Record<string, unknown> {
  if (Object.keys(shape).length === 0) return { type: "object" };

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(shape)) {
    // deno-lint-ignore no-explicit-any
    const def = (field as any)._def;
    const isOptional = def?.typeName === "ZodOptional";
    const innerField: z.ZodTypeAny = isOptional ? def.innerType : field;

    properties[key] = inferPropertySchema(innerField);
    if (!isOptional) required.push(key);
  }

  const schema: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

// ─── Tool registry ────────────────────────────────────────────────────────────

interface ToolEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function buildRegistry(
  // deno-lint-ignore no-explicit-any
  client: any,
  agent: { client_id: string; role: string }
): Map<string, ToolEntry> {
  const registry = new Map<string, ToolEntry>();

  const mockServer = {
    tool(
      name: string,
      description: string,
      shape: Record<string, z.ZodTypeAny>,
      handler: (args: Record<string, unknown>) => Promise<unknown>
    ) {
      const zodSchema = z.object(shape);
      registry.set(name, {
        name,
        description,
        inputSchema: shapeToInputSchema(shape),
        handler: async (args: Record<string, unknown>) => {
          const parsed = zodSchema.parse(args);
          return handler(parsed as Record<string, unknown>);
        },
      });
    },
  };

  // deno-lint-ignore no-explicit-any
  registerTools(mockServer as any, client, agent);
  return registry;
}

// ─── Request handler ──────────────────────────────────────────────────────────

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

  // JSON-RPC dispatch — no MCP SDK transport involved
  try {
    const body = await req.json();
    const { method, id, params } = body;

    const registry = buildRegistry(supabase, agent);

    switch (method) {
      case "tools/list": {
        const tools = [...registry.values()].map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        return Response.json(
          { jsonrpc: "2.0", id, result: { tools } },
          { headers: SECURITY_HEADERS }
        );
      }

      case "tools/call": {
        const tool = registry.get(params?.name);
        if (!tool) {
          return Response.json(
            {
              jsonrpc: "2.0",
              id,
              error: { code: -32601, message: `Unknown tool: ${params?.name}` },
            },
            { headers: SECURITY_HEADERS }
          );
        }
        const result = await tool.handler(params?.arguments ?? {});
        return Response.json(
          { jsonrpc: "2.0", id, result },
          { headers: SECURITY_HEADERS }
        );
      }

      default:
        return Response.json(
          {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          },
          { headers: SECURITY_HEADERS }
        );
    }
  } catch (e) {
    console.error("MCP dispatch error:", e);
    return new Response("Internal error", { status: 500, headers: SECURITY_HEADERS });
  }
});
