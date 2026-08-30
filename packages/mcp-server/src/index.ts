import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PilotApiClient } from "./client.js";
import { readConfigFromEnv, type PilotMcpConfig } from "./config.js";
import { createToolDefinitions } from "./tools.js";

export function createPilotMcpServer(config: PilotMcpConfig = readConfigFromEnv()) {
  const server = new McpServer({
    name: "pilot",
    version: "0.1.0",
  });

  const client = new PilotApiClient(config);
  const tools = createToolDefinitions(client);
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.schema.shape, tool.execute);
  }

  return {
    server,
    tools,
    client,
  };
}

export async function runServer(config: PilotMcpConfig = readConfigFromEnv()) {
  const { server } = createPilotMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
