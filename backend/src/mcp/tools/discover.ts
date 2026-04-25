import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { discoverService } from "../../discover/service.js";
import { withToolHandler, toolResult, mcpError } from "./utils.js";

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
      asset_class: z
        .string()
        .optional()
        .default("stablecoin")
        .describe("Filter by asset class: stablecoin, sol, btc, eth, other (default: stablecoin)"),
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
    withToolHandler("search_yields", async (args) => {
      const result = await discoverService.searchYields({
        category: args.category,
        tokens: args.tokens,
        asset_class: args.asset_class,
        sort: args.sort,
        limit: args.limit,
      });
      return toolResult(result);
    }),
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
    withToolHandler("get_yield_details", async (args) => {
      const opp = await discoverService.getOpportunityById(args.opportunity_id);
      if (!opp) return mcpError("Opportunity not found");
      return toolResult(opp);
    }),
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
    withToolHandler("get_yield_history", async (args) => {
      const result = await discoverService.getYieldHistory(args.opportunity_id, args.period);
      if (!result) return mcpError("Opportunity not found");
      return toolResult(result);
    }),
  );

  server.tool(
    "get_protocols",
    "List all supported DeFi protocols with their audit status and integration details.",
    {},
    withToolHandler("get_protocols", async () => {
      const result = await discoverService.getProtocols();
      return toolResult(result);
    }),
  );
}
