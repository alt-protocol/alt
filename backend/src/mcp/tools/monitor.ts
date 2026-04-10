import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { monitorService } from "../../monitor/service.js";
import { validateWallet } from "../../monitor/services/utils.js";
import { logger } from "../../shared/logger.js";

function mcpError(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function registerMonitorTools(server: McpServer) {
  server.tool(
    "get_portfolio",
    "Get DeFi portfolio positions for a Solana wallet. Shows deposits, PnL, APY across Kamino, Drift, and Jupiter protocols.",
    {
      wallet_address: z
        .string()
        .describe("Solana wallet address (base58)"),
    },
    async (args) => {
      try {
        // Ensure wallet is tracked
        await monitorService.trackWallet(args.wallet_address);

        // Check if we have data
        const status = await monitorService.getWalletStatus(args.wallet_address);
        if (!status || status.fetch_status === "fetching") {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  wallet: args.wallet_address,
                  status: "fetching",
                  message:
                    "Portfolio data is being fetched. This may take 30-60 seconds for a new wallet. Call this tool again shortly.",
                  positions: [],
                  summary: { total_value_usd: 0, total_pnl_usd: 0, position_count: 0 },
                }),
              },
            ],
          };
        }

        const result = await monitorService.getPortfolioPositions(args.wallet_address);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to get portfolio";
        logger.error({ err }, "MCP get_portfolio failed");
        return mcpError(message);
      }
    },
  );

  server.tool(
    "track_wallet",
    "Register a wallet for portfolio tracking. Triggers background fetching of positions from all protocols. Call get_wallet_status to check progress.",
    {
      wallet_address: z.string().describe("Solana wallet address (base58)"),
    },
    async (args) => {
      try {
        validateWallet(args.wallet_address);
        await monitorService.trackWallet(args.wallet_address);
        const status = await monitorService.getWalletStatus(args.wallet_address);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ wallet: args.wallet_address, ...status }) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to track wallet";
        logger.error({ err }, "MCP track_wallet failed");
        return mcpError(message);
      }
    },
  );

  server.tool(
    "get_wallet_status",
    "Check the fetch status of a tracked wallet (fetching/ready/error).",
    {
      wallet_address: z.string().describe("Solana wallet address (base58)"),
    },
    async (args) => {
      try {
        const status = await monitorService.getWalletStatus(args.wallet_address);
        if (!status) return mcpError("Wallet not tracked. Call track_wallet first.");
        return {
          content: [{ type: "text" as const, text: JSON.stringify(status) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to get wallet status";
        logger.error({ err }, "MCP get_wallet_status failed");
        return mcpError(message);
      }
    },
  );

  server.tool(
    "get_wallet_balances",
    "Get raw SPL token balances for a Solana wallet (all tokens, not just DeFi positions).",
    {
      wallet_address: z.string().describe("Solana wallet address (base58)"),
    },
    async (args) => {
      try {
        validateWallet(args.wallet_address);
        const result = await monitorService.getWalletBalances(args.wallet_address);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to get wallet balances";
        logger.error({ err }, "MCP get_wallet_balances failed");
        return mcpError(message);
      }
    },
  );

  server.tool(
    "get_position_history",
    "Get historical portfolio value and PnL over time for a tracked wallet.",
    {
      wallet_address: z.string().describe("Solana wallet address (base58)"),
      period: z.enum(["7d", "30d", "90d"]).optional().default("7d").describe("Time period"),
      external_id: z.string().optional().describe("Filter to a specific position by external ID"),
    },
    async (args) => {
      try {
        validateWallet(args.wallet_address);
        const result = await monitorService.getPositionHistory(
          args.wallet_address,
          args.period,
          args.external_id,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to get position history";
        logger.error({ err }, "MCP get_position_history failed");
        return mcpError(message);
      }
    },
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
    async (args) => {
      try {
        validateWallet(args.wallet_address);
        const result = await monitorService.getPositionEvents(
          args.wallet_address,
          args.protocol,
          args.product_type,
          args.limit,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to get position events";
        logger.error({ err }, "MCP get_position_events failed");
        return mcpError(message);
      }
    },
  );
}
