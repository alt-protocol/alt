import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { monitorService } from "../../monitor/service.js";
import { validateWallet } from "../../monitor/services/utils.js";
import { withToolHandler, toolResult, mcpError } from "./utils.js";

export function registerMonitorTools(server: McpServer) {
  server.tool(
    "get_portfolio",
    "Get DeFi portfolio positions for a Solana wallet. Shows deposits, PnL, APY across Kamino, Drift, and Jupiter protocols.",
    {
      wallet_address: z
        .string()
        .describe("Solana wallet address (base58)"),
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

      const result = await monitorService.getPortfolioPositions(args.wallet_address);
      return toolResult(result);
    }),
  );

  server.tool(
    "track_wallet",
    "Register a wallet for portfolio tracking. Triggers background fetching of positions from all protocols. Call get_wallet_status to check progress.",
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
    "get_wallet_status",
    "Check the fetch status of a tracked wallet (fetching/ready/error).",
    {
      wallet_address: z.string().describe("Solana wallet address (base58)"),
    },
    withToolHandler("get_wallet_status", async (args) => {
      const status = await monitorService.getWalletStatus(args.wallet_address);
      if (!status) return mcpError("Wallet not tracked. Call track_wallet first.");
      return toolResult(status);
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

  server.tool(
    "get_portfolio_analytics",
    "Get portfolio analytics: summary stats (ROI, weighted APY, projected yield), stablecoin allocation, and diversification breakdown by protocol/category/token. Use for risk assessment and portfolio overview.",
    {
      wallet_address: z.string().describe("Solana wallet address (base58)"),
    },
    withToolHandler("get_portfolio_analytics", async (args) => {
      validateWallet(args.wallet_address);
      const result = await monitorService.getPortfolioAnalytics(args.wallet_address);
      return toolResult(result);
    }),
  );
}
