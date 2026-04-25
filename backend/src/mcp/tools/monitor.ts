import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { monitorService } from "../../monitor/service.js";
import { validateWallet } from "../../monitor/services/utils.js";
import { withToolHandler, toolResult } from "./utils.js";

export function registerMonitorTools(server: McpServer) {
  server.tool(
    "get_portfolio",
    "Get DeFi portfolio positions for a Solana wallet. Shows deposits, PnL, APY across Kamino, Drift, and Jupiter protocols. Set include_analytics=true to also get ROI, weighted APY, projected yield, and diversification breakdown.",
    {
      wallet_address: z
        .string()
        .describe("Solana wallet address (base58)"),
      include_analytics: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include portfolio analytics (ROI, weighted APY, diversification)"),
    },
    withToolHandler("get_portfolio", async (args) => {
      await monitorService.trackWallet(args.wallet_address);

      const status = await monitorService.getWalletStatus(args.wallet_address);
      if (!status || status.fetch_status === "fetching") {
        return toolResult({
          wallet: args.wallet_address,
          status: "fetching",
          message:
            "Portfolio data is being fetched. This may take 30-60 seconds for a new wallet. Call this tool again shortly.",
          positions: [],
          summary: { total_value_usd: 0, total_pnl_usd: 0, position_count: 0 },
        });
      }

      if (args.include_analytics) {
        const analytics = await monitorService.getPortfolioAnalytics(args.wallet_address);
        return toolResult(analytics);
      }

      const result = await monitorService.getPortfolioPositions(args.wallet_address);
      return toolResult(result);
    }),
  );

  server.tool(
    "track_wallet",
    "Register or check a wallet for portfolio tracking. Triggers background fetching and returns current fetch status (fetching/ready/error). Idempotent — safe to call repeatedly.",
    {
      wallet_address: z.string().describe("Solana wallet address (base58)"),
    },
    withToolHandler("track_wallet", async (args) => {
      validateWallet(args.wallet_address);
      await monitorService.trackWallet(args.wallet_address);
      const status = await monitorService.getWalletStatus(args.wallet_address);
      return toolResult({ wallet: args.wallet_address, ...status });
    }),
  );

  server.tool(
    "get_wallet_balances",
    "Get raw SPL token balances for a Solana wallet (all tokens, not just DeFi positions).",
    {
      wallet_address: z.string().describe("Solana wallet address (base58)"),
    },
    withToolHandler("get_wallet_balances", async (args) => {
      validateWallet(args.wallet_address);
      const result = await monitorService.getWalletBalances(args.wallet_address);
      return toolResult(result);
    }),
  );

  server.tool(
    "get_position_history",
    "Get historical portfolio value and PnL over time for a tracked wallet.",
    {
      wallet_address: z.string().describe("Solana wallet address (base58)"),
      period: z.enum(["7d", "30d", "90d"]).optional().default("7d").describe("Time period"),
      external_id: z.string().optional().describe("Filter to a specific position by external ID"),
    },
    withToolHandler("get_position_history", async (args) => {
      validateWallet(args.wallet_address);
      const result = await monitorService.getPositionHistory(
        args.wallet_address,
        args.period,
        args.external_id,
      );
      return toolResult(result);
    }),
  );

  server.tool(
    "get_position_events",
    "Get transaction events (deposits, withdrawals, etc.) for a tracked wallet.",
    {
      wallet_address: z.string().describe("Solana wallet address (base58)"),
      protocol: z.string().optional().describe("Filter by protocol slug (e.g. 'drift', 'kamino')"),
      product_type: z.string().optional().describe("Filter by product type"),
      limit: z.number().int().min(1).max(100).optional().default(50).describe("Max events to return"),
    },
    withToolHandler("get_position_events", async (args) => {
      validateWallet(args.wallet_address);
      const result = await monitorService.getPositionEvents(
        args.wallet_address,
        args.protocol,
        args.product_type,
        args.limit,
      );
      return toolResult(result);
    }),
  );

}
