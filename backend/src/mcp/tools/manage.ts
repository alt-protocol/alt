import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildTransaction } from "../../manage/services/tx-builder.js";
import { assembleTransaction } from "../../manage/services/tx-assembler.js";
import { serializeResult } from "../../manage/services/instruction-serializer.js";
import { generateSignOptions } from "../../manage/services/sign-options.js";
import { guardWalletValid, guardProgramWhitelist } from "../../manage/services/guards.js";
import { getSwapQuote, buildSwapInstructions } from "../../manage/services/jupiter-swap.js";
import { getAdapter } from "../../manage/protocols/index.js";
import { getMultiplyStats } from "../../manage/protocols/kamino.js";
import { getJupiterMultiplyStats } from "../../manage/protocols/jupiter.js";
import { fetchWalletBalance } from "../../manage/services/wallet-balance.js";
import { discoverService } from "../../discover/service.js";
import { monitorService } from "../../monitor/service.js";
import { validateApiKey } from "../../shared/auth.js";
import { logger } from "../../shared/logger.js";
import { withToolHandler, toolResult, mcpError } from "./utils.js";
import type { McpRequestContext } from "../server.js";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TX_SUBMIT_TIMEOUT_MS = 30_000;

async function buildAndAssemble(
  opportunityId: number,
  walletAddress: string,
  amount: string,
  action: "deposit" | "withdraw",
  extraData?: Record<string, unknown>,
) {
  const result = await buildTransaction(
    { opportunity_id: opportunityId, wallet_address: walletAddress, amount, extra_data: extraData },
    action,
  );

  const assembled = await assembleTransaction(
    result.instructions,
    walletAddress,
    result.lookupTableAddresses,
  );

  let setupTransactions: string[] | undefined;
  if (result.setupInstructionSets?.length) {
    setupTransactions = [];
    for (const setupIxs of result.setupInstructionSets) {
      if (setupIxs.length === 0) continue;
      const setupAssembled = await assembleTransaction(setupIxs, walletAddress, result.lookupTableAddresses);
      setupTransactions.push(setupAssembled.transaction);
    }
  }

  const opp = await discoverService.getOpportunityById(opportunityId);
  const oppName = opp?.name ?? `opportunity #${opportunityId}`;
  const protocol = opp?.protocol?.name ?? "unknown protocol";
  const apyStr = opp?.apy_current ? ` (~${opp.apy_current.toFixed(1)}% APY)` : "";
  const summary = action === "deposit"
    ? `Deposit ${amount} into ${oppName} on ${protocol}${apyStr}`
    : `Withdraw ${amount} from ${oppName} on ${protocol}`;

  const sign = await generateSignOptions(action, opportunityId, amount, walletAddress, extraData);

  return {
    transaction: assembled.transaction,
    blockhash: assembled.blockhash,
    lastValidBlockHeight: assembled.lastValidBlockHeight,
    ...(setupTransactions?.length ? { setup_transactions: setupTransactions } : {}),
    summary,
    sign,
  };
}

/** Validate API key for MCP write operations. Returns error result if auth fails. */
async function guardMcpAuth(ctx?: McpRequestContext) {
  if (process.env.MANAGE_AUTH_DISABLED === "true" && process.env.NODE_ENV !== "production") return null;
  if (!ctx?.bearerToken) return mcpError("API key required for transaction operations. Pass Authorization: Bearer <key> header.");
  const result = await validateApiKey(ctx.bearerToken);
  if (!result) return mcpError("Invalid or rate-limited API key");
  return null;
}

export function registerManageTools(server: McpServer, ctx?: McpRequestContext) {
  server.tool(
    "build_deposit_tx",
    "Build an unsigned deposit transaction for a yield opportunity. Returns a base64-encoded transaction ready for signing. The transaction expires in ~60 seconds. For multiply positions, include leverage (required) and optionally action, position_id.",
    {
      opportunity_id: z.number().int().positive().describe("The yield opportunity ID (from search_yields)"),
      wallet_address: z.string().describe("Solana wallet address that will sign and pay fees"),
      amount: z.string().describe("Amount to deposit in human-readable format, e.g. '100.5'"),
      leverage: z.number().min(1).optional().describe("Leverage multiplier for multiply positions (e.g. 2.0 = 2x). Only needed for multiply category. Typical range: 1.5–5.0"),
      slippage_bps: z.number().int().min(1).max(1000).optional().default(30).describe("Slippage tolerance in basis points. Default: 30 (0.3%). Use 100-300 for multiply positions."),
      action: z.enum(["open", "close", "adjust", "add_collateral", "withdraw_collateral", "borrow_more", "repay_debt"]).optional().default("open").describe("Position action. Default: open (new position). Only change for managing existing multiply positions."),
      position_id: z.string().optional().describe("Existing position ID — only needed for multiply close/adjust, not for new deposits."),
      deposit_token: z.enum(["debt", "collateral"]).optional().describe("Which token to deposit for multiply positions. Leave empty for lending/vault/earn."),
    },
    withToolHandler("build_deposit_tx", async (args) => {
      logger.info({ agentId: ctx?.agentId, tool: "build_deposit_tx", wallet: args.wallet_address, opportunityId: args.opportunity_id, amount: args.amount }, "MCP: build deposit tx");

      const extraData: Record<string, unknown> = {};
      if (args.leverage != null) extraData.leverage = args.leverage;
      if (args.slippage_bps != null) extraData.slippageBps = args.slippage_bps;
      if (args.action && args.action !== "open") extraData.action = args.action;
      if (args.position_id) extraData.position_id = args.position_id;
      if (args.deposit_token) extraData.deposit_token = args.deposit_token;

      const result = await buildAndAssemble(
        args.opportunity_id, args.wallet_address, args.amount, "deposit",
        Object.keys(extraData).length ? extraData : undefined,
      );
      return toolResult(result);
    }),
  );

  server.tool(
    "build_withdraw_tx",
    "Build an unsigned withdrawal transaction from a yield opportunity. Returns a base64-encoded transaction ready for signing. The transaction expires in ~60 seconds. For multiply positions, include position_id and optionally action.",
    {
      opportunity_id: z.number().int().positive().describe("The yield opportunity ID"),
      wallet_address: z.string().describe("Solana wallet address that will sign and pay fees"),
      amount: z.string().describe("Amount to withdraw in human-readable format, e.g. '100.5'"),
      slippage_bps: z.number().int().min(1).max(1000).optional().default(30).describe("Slippage tolerance in basis points. Default: 30 (0.3%). Use 100-300 for multiply positions."),
      action: z.enum(["close", "adjust", "withdraw_collateral", "repay_debt"]).optional().default("close").describe("Position action. Default: close. Only change for managing existing multiply positions."),
      position_id: z.string().optional().describe("Existing position ID — only needed for multiply close/adjust."),
    },
    withToolHandler("build_withdraw_tx", async (args) => {
      logger.info({ agentId: ctx?.agentId, tool: "build_withdraw_tx", wallet: args.wallet_address, opportunityId: args.opportunity_id, amount: args.amount }, "MCP: build withdraw tx");

      const extraData: Record<string, unknown> = {};
      if (args.slippage_bps != null) extraData.slippageBps = args.slippage_bps;
      if (args.action && args.action !== "close") extraData.action = args.action;
      if (args.position_id) extraData.position_id = args.position_id;

      const result = await buildAndAssemble(
        args.opportunity_id, args.wallet_address, args.amount, "withdraw",
        Object.keys(extraData).length ? extraData : undefined,
      );
      return toolResult(result);
    }),
  );

  server.tool(
    "submit_transaction",
    "Submit a signed Solana transaction to the network. The transaction must already be signed. If opportunity_id and wallet_address are provided, automatically syncs the position to the portfolio.",
    {
      signed_transaction: z.string().min(1).describe("Base64-encoded signed transaction"),
      opportunity_id: z.number().int().positive().optional().describe("Yield opportunity ID — if provided with wallet_address, auto-syncs position after submit"),
      wallet_address: z.string().optional().describe("Wallet address — required with opportunity_id for auto-sync"),
    },
    withToolHandler("submit_transaction", async (args) => {
      const authErr = await guardMcpAuth(ctx);
      if (authErr) return authErr;

      logger.info({ agentId: ctx?.agentId, tool: "submit_transaction", wallet: args.wallet_address }, "MCP: submit transaction");

      const web3 = await import("@solana/web3.js");
      const connection = new web3.Connection(process.env.HELIUS_RPC_URL!);
      const txBytes = Buffer.from(args.signed_transaction, "base64");

      const sendPromise = connection.sendRawTransaction(txBytes, {
        skipPreflight: false,
        maxRetries: 3,
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Transaction submission timed out (30s)")), TX_SUBMIT_TIMEOUT_MS),
      );
      const signature = await Promise.race([sendPromise, timeoutPromise]);

      // Auto-sync position if opportunity context provided
      if (args.opportunity_id && args.wallet_address) {
        try {
          await monitorService.syncPosition(args.wallet_address, args.opportunity_id);
        } catch { /* non-critical — position will sync on next background fetch */ }
      }

      return toolResult({ signature, status: "submitted" });
    }),
  );

  server.tool(
    "get_balance",
    "Get the current deposited balance for a wallet in a specific yield opportunity.",
    {
      opportunity_id: z.number().int().positive().describe("The yield opportunity ID"),
      wallet_address: z.string().describe("Solana wallet address (base58)"),
    },
    withToolHandler("get_balance", async (args) => {
      const opp = await discoverService.getOpportunityById(args.opportunity_id);
      if (!opp?.protocol?.slug || !opp.deposit_address) {
        return mcpError("Opportunity not found or missing deposit address");
      }
      const adapter = await getAdapter(opp.protocol.slug);
      if (!adapter?.getBalance) {
        return mcpError(`Balance check not supported for ${opp.protocol.slug}`);
      }
      const balance = await adapter.getBalance({
        walletAddress: args.wallet_address,
        depositAddress: opp.deposit_address,
        category: opp.category,
        extraData: opp.extra_data ?? {},
      });
      return toolResult({ balance, opportunity: opp.name, protocol: opp.protocol.name });
    }),
  );

  server.tool(
    "get_withdraw_state",
    "Check withdrawal state for protocols with redemption periods (e.g., Drift's 3-day redeem).",
    {
      opportunity_id: z.number().int().positive().describe("The yield opportunity ID"),
      wallet_address: z.string().describe("Solana wallet address (base58)"),
    },
    withToolHandler("get_withdraw_state", async (args) => {
      const opp = await discoverService.getOpportunityById(args.opportunity_id);
      if (!opp?.protocol?.slug || !opp.deposit_address) {
        return mcpError("Opportunity not found");
      }
      const adapter = await getAdapter(opp.protocol.slug);
      if (!adapter?.getWithdrawState) {
        return mcpError(`Withdraw state not supported for ${opp.protocol.slug}`);
      }
      const state = await adapter.getWithdrawState({
        walletAddress: args.wallet_address,
        depositAddress: opp.deposit_address,
        category: opp.category,
        extraData: opp.extra_data ?? {},
      });
      return toolResult({ withdraw_state: state });
    }),
  );

  server.tool(
    "swap",
    "Jupiter token swap. With quote_only=true returns a quote (no auth needed). With quote_only=false (default) builds an unsigned swap transaction ready for signing.",
    {
      wallet_address: z.string().regex(BASE58_RE, "Invalid Solana address").describe("Solana wallet address (taker / signer)"),
      input_mint: z.string().regex(BASE58_RE, "Invalid Solana address").describe("Input token mint address"),
      output_mint: z.string().regex(BASE58_RE, "Invalid Solana address").describe("Output token mint address"),
      amount: z.string().describe("Amount in smallest units (lamports for SOL, etc.)"),
      slippage_bps: z.number().int().min(1).max(500).optional().default(50).describe("Slippage tolerance in basis points (default: 50 = 0.5%)"),
      quote_only: z.boolean().optional().default(false).describe("If true, return quote without building transaction (no auth required)"),
    },
    withToolHandler("swap", async (args) => {
      guardWalletValid(args.wallet_address);

      const swapParams = {
        inputMint: args.input_mint,
        outputMint: args.output_mint,
        amount: args.amount,
        slippageBps: args.slippage_bps,
        taker: args.wallet_address,
      };

      if (args.quote_only) {
        const quote = await getSwapQuote(swapParams);
        return toolResult(quote);
      }

      const authErr = await guardMcpAuth(ctx);
      if (authErr) return authErr;

      logger.info({ agentId: ctx?.agentId, tool: "swap", wallet: args.wallet_address }, "MCP: build swap tx");

      const result = await buildSwapInstructions(swapParams);
      const serialized = serializeResult(result);
      guardProgramWhitelist(serialized.instructions);

      const assembled = await assembleTransaction(
        serialized.instructions,
        args.wallet_address,
        serialized.lookupTableAddresses,
      );

      return toolResult({
        transaction: assembled.transaction,
        blockhash: assembled.blockhash,
        lastValidBlockHeight: assembled.lastValidBlockHeight,
        summary: `Swap ${args.amount} (${args.input_mint.slice(0, 8)}...) → ${args.output_mint.slice(0, 8)}...`,
      });
    }),
  );

  server.tool(
    "get_wallet_balance",
    "Get the on-chain SPL token balance for a wallet and mint address.",
    {
      wallet_address: z.string().regex(BASE58_RE, "Invalid Solana address").describe("Solana wallet address"),
      mint: z.string().regex(BASE58_RE, "Invalid Solana address").describe("SPL token mint address"),
    },
    withToolHandler("get_wallet_balance", async (args) => {
      const balance = await fetchWalletBalance(args.wallet_address, args.mint);
      return toolResult({ balance, wallet: args.wallet_address, mint: args.mint });
    }),
  );

  server.tool(
    "get_position_stats",
    "Get on-chain multiply (leveraged) position stats including collateral, debt, and leverage ratio. Only works for multiply category opportunities.",
    {
      opportunity_id: z.number().int().positive().describe("The yield opportunity ID (must be a multiply category)"),
      wallet_address: z.string().describe("Solana wallet address (base58)"),
    },
    withToolHandler("get_position_stats", async (args) => {
      const opp = await discoverService.getOpportunityById(args.opportunity_id);
      if (!opp?.extra_data || opp.category !== "multiply") {
        return mcpError("Opportunity not found or not a multiply position");
      }
      const extra = opp.extra_data as Record<string, unknown>;
      const stats = opp.protocol?.slug === "jupiter"
        ? await getJupiterMultiplyStats(args.wallet_address, extra)
        : await getMultiplyStats(args.wallet_address, extra);
      return toolResult(stats);
    }),
  );

  server.tool(
    "get_price_impact",
    "Estimate price impact for a deposit or withdrawal on a multiply position.",
    {
      opportunity_id: z.number().int().positive().describe("The yield opportunity ID (must be multiply category)"),
      wallet_address: z.string().describe("Solana wallet address (base58)"),
      amount: z.string().describe("Amount in human-readable format"),
      direction: z.enum(["deposit", "withdraw"]).describe("Whether this is a deposit or withdraw"),
    },
    withToolHandler("get_price_impact", async (args) => {
      const opp = await discoverService.getOpportunityById(args.opportunity_id);
      if (!opp?.protocol?.slug || !opp.deposit_address || opp.category !== "multiply") {
        return mcpError("Opportunity not found or not a multiply position");
      }
      const adapter = await getAdapter(opp.protocol.slug);
      if (!adapter?.getPriceImpact) {
        return mcpError(`Price impact not supported for ${opp.protocol.slug}`);
      }
      const result = await adapter.getPriceImpact({
        walletAddress: args.wallet_address,
        depositAddress: opp.deposit_address,
        category: opp.category,
        amount: args.amount,
        direction: args.direction,
        extraData: { ...(opp.extra_data ?? {}), },
      });
      return toolResult(result);
    }),
  );
}
