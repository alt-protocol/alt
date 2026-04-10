import pino from "pino";

// In MCP stdio mode, stdout is the JSON-RPC transport — logs must go to stderr (fd 2).
const logDestination = process.env.MCP_STDIO ? 2 : 1;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino/file", options: { destination: logDestination } }
      : undefined,
});
