import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { loadConfig } from "./config.js";
import { TtlCache } from "./cache/ttl-cache.js";
import { BasecampClient } from "./basecamp/client.js";
import { BasecampService } from "./basecamp/service.js";
import { createBasecampMcpServer } from "./mcp/server.js";

const ENDPOINT = "/sse";
const DEFAULT_PORT = 3847;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const port = Number(process.env.MCP_PORT ?? DEFAULT_PORT);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`MCP_PORT must be 1–65535, got: ${process.env.MCP_PORT}`);
  }

  const cache = new TtlCache();
  const client = new BasecampClient(config);
  const service = new BasecampService(client, config, cache);

  const sessionMap = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: ReturnType<typeof createBasecampMcpServer> }
  >();
  const pending: Array<{
    transport: StreamableHTTPServerTransport;
    server: ReturnType<typeof createBasecampMcpServer>;
  }> = [];

  function createSession(): {
    transport: StreamableHTTPServerTransport;
    server: ReturnType<typeof createBasecampMcpServer>;
  } {
    const mcpServer = createBasecampMcpServer(service, config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessionMap.set(sessionId, { transport, server: mcpServer });
        const i = pending.findIndex((p) => p.transport === transport);
        if (i >= 0) pending.splice(i, 1);
      },
      onsessionclosed: (sessionId) => {
        sessionMap.delete(sessionId);
      }
    });
    return { transport, server: mcpServer };
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown
  ): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessionMap.has(sessionId)) {
      const { transport } = sessionMap.get(sessionId)!;
      await transport.handleRequest(req, res, parsedBody);
      return;
    }

    if (sessionId) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }));
      return;
    }

    if (req.method === "GET") {
      const { transport, server } = createSession();
      pending.push({ transport, server });
      await transport.handleRequest(req, res, parsedBody);
      return;
    }

    if (req.method === "POST") {
      const entry = pending.shift();
      const { transport, server } = entry ?? createSession();
      if (!entry) {
        await server.connect(transport);
      }
      await transport.handleRequest(req, res, parsedBody);
      return;
    }

    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32600, message: "Method Not Allowed" }, id: null })
    );
  }

  const httpServer = createServer(async (req, res) => {
    if (req.url?.split("?")[0] !== ENDPOINT) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    let parsedBody: unknown;
    if (req.method === "POST") {
      try {
        parsedBody = await readBody(req);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null })
        );
        return;
      }
    }

    try {
      await handle(req, res, parsedBody);
    } catch (err) {
      console.error("Basecamp MCP HTTP error:", err);
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: err instanceof Error ? err.message : "Internal error" },
            id: null
          })
        );
      }
    }
  });

  httpServer.listen(port, "127.0.0.1", () => {
    console.error(`Basecamp MCP server listening on http://127.0.0.1:${port}${ENDPOINT}`);
  });
}

main().catch((error) => {
  console.error("Failed to start Basecamp MCP HTTP server:", error);
  process.exit(1);
});
