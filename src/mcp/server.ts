import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AppConfig } from "../config.js";
import { BasecampService } from "../basecamp/service.js";
import { createToolDefinitions } from "./tools.js";

export function createBasecampMcpServer(
  service: BasecampService,
  config: AppConfig
): McpServer {
  const server = new McpServer(
    {
      name: "basecamp-starred-mcp",
      version: "0.1.0"
    },
    {
      instructions:
        "Use the Basecamp tools to inspect starred projects only. Prefer scoped queries over broad ones."
    }
  );

  for (const tool of createToolDefinitions(service, config)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema
      },
      async (args) => tool.handler(tool.inputSchema.parse(args ?? {}))
    );
  }

  return server;
}
