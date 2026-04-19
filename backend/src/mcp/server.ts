import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDiscoverTools } from "./tools/discover.js";
import { registerMonitorTools } from "./tools/monitor.js";
import { registerManageTools } from "./tools/manage.js";

export interface McpRequestContext {
  /** Bearer token from Authorization header (if present) */
  bearerToken: string | null;
  /** Agent identifier from X-Agent-Id header (if present) */
  agentId: string;
}

export function createMcpServer(ctx: McpRequestContext): McpServer {
  const server = new McpServer({
    name: "akashi",
    version: "0.1.0",
  });

  registerDiscoverTools(server);
  registerMonitorTools(server);
  registerManageTools(server, ctx);

  return server;
}
