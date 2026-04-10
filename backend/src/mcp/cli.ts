#!/usr/bin/env node

/**
 * MCP CLI entry point — runs the Akashi MCP server over stdio transport.
 *
 * Usage:
 *   npx tsx src/mcp/cli.ts
 *
 * For Claude Desktop, add to claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "akashi": {
 *         "command": "npx",
 *         "args": ["tsx", "src/mcp/cli.ts"],
 *         "cwd": "/path/to/backend",
 *         "env": { "DATABASE_URL": "...", "HELIUS_API_KEY": "...", "HELIUS_RPC_URL": "..." }
 *       }
 *     }
 *   }
 */

// Redirect pino logger to stderr BEFORE any imports that use it.
// In stdio mode, stdout is the MCP JSON-RPC transport — logging there would corrupt it.
process.env.MCP_STDIO = "1";

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

const REQUIRED_ENV = ["DATABASE_URL", "HELIUS_API_KEY", "HELIUS_RPC_URL"];

async function main() {
  const missing = REQUIRED_ENV.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    process.stderr.write(
      `Missing required env vars: ${missing.join(", ")}\n`,
    );
    process.exit(1);
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP server failed: ${err}\n`);
  process.exit(1);
});
