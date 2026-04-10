import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { discoverService } from "../../discover/service.js";
import { logger } from "../../shared/logger.js";

function mcpError(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function registerDiscoverTools(server: McpServer) {
  server.tool(
    "search_yields",
    "Search Solana yield opportunities with filters. Returns APY, TVL, protocol, and token data.",
    {
      category: z
        .enum(["earn", "lending", "vault", "multiply", "insurance-fund"])
        .optional()
        .describe("Filter by yield category"),
      tokens: z
        .string()
        .optional()
        .describe("Comma-separated token symbols, e.g. 'USDC,USDT'"),
      stablecoins_only: z
        .boolean()
        .optional()
        .default(true)
        .describe("Only show stablecoin opportunities (default: true)"),
      sort: z
        .enum(["apy_desc", "apy_asc", "tvl_desc", "tvl_asc"])
        .optional()
        .default("apy_desc")
        .describe("Sort order (default: apy_desc)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(10)
        .describe("Max results to return (default: 10, max: 50)"),
    },
    async (args) => {
      try {
        const result = await discoverService.searchYields({
          category: args.category,
          tokens: args.tokens,
          stablecoins_only: args.stablecoins_only,
          sort: args.sort,
          limit: args.limit,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Search failed";
        logger.error({ err }, "MCP search_yields failed");
        return mcpError(message);
      }
    },
  );

  server.tool(
    "get_yield_details",
    "Get detailed information about a specific yield opportunity including protocol info, APY history, and deposit address.",
    {
      opportunity_id: z
        .number()
        .int()
        .positive()
        .describe("The yield opportunity ID"),
    },
    async (args) => {
      try {
        const opp = await discoverService.getOpportunityById(args.opportunity_id);
        if (!opp) return mcpError("Opportunity not found");

        return {
          content: [{ type: "text" as const, text: JSON.stringify(opp, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to get yield details";
        logger.error({ err }, "MCP get_yield_details failed");
        return mcpError(message);
      }
    },
  );

  server.tool(
    "get_yield_history",
    "Get historical APY and TVL snapshots for a yield opportunity over time.",
    {
      opportunity_id: z
        .number()
        .int()
        .positive()
        .describe("The yield opportunity ID"),
      period: z
        .enum(["7d", "30d", "90d"])
        .optional()
        .default("7d")
        .describe("Time period (default: 7d)"),
    },
    async (args) => {
      try {
        const result = await discoverService.getYieldHistory(args.opportunity_id, args.period);
        if (!result) return mcpError("Opportunity not found");

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to get yield history";
        logger.error({ err }, "MCP get_yield_history failed");
        return mcpError(message);
      }
    },
  );

  server.tool(
    "get_protocols",
    "List all supported DeFi protocols with their audit status and integration details.",
    {},
    async () => {
      try {
        const result = await discoverService.getProtocols();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to get protocols";
        logger.error({ err }, "MCP get_protocols failed");
        return mcpError(message);
      }
    },
  );
}
