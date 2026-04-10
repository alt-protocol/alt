import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDiscoverTools } from "./tools/discover.js";
import { registerMonitorTools } from "./tools/monitor.js";
import { registerManageTools } from "./tools/manage.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "akashi",
    version: "0.1.0",
  });

  registerDiscoverTools(server);
  registerMonitorTools(server);
  registerManageTools(server);

  return server;
}
