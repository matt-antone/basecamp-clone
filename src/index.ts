import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { TtlCache } from "./cache/ttl-cache.js";
import { BasecampClient } from "./basecamp/client.js";
import { BasecampService } from "./basecamp/service.js";
import { createBasecampMcpServer } from "./mcp/server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const cache = new TtlCache();
  const client = new BasecampClient(config);
  const service = new BasecampService(client, config, cache);
  const server = createBasecampMcpServer(service, config);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error("Basecamp MCP server running on stdio");
}

main().catch((error) => {
  console.error("Failed to start Basecamp MCP server:", error);
  process.exit(1);
});
