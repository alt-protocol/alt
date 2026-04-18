import { logger } from "../../shared/logger.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function mcpError(message: string): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function toolResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

export function withToolHandler<T>(
  toolName: string,
  handler: (args: T) => Promise<ToolResult>,
): (args: T) => Promise<ToolResult> {
  return async (args: T) => {
    try {
      return await handler(args);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `${toolName} failed`;
      logger.error({ err }, `MCP ${toolName} failed`);
      return mcpError(message);
    }
  };
}
