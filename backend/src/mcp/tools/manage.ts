import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildTransaction } from "../../manage/services/tx-builder.js";
import { assembleTransaction } from "../../manage/services/tx-assembler.js";
import { serializeResult } from "../../manage/services/instruction-serializer.js";
import { guardWalletValid, guardProgramWhitelist } from "../../manage/services/guards.js";
import { getSwapQuote, buildSwapInstructions } from "../../manage/services/jupiter-swap.js";
import { getAdapter } from "../../manage/protocols/index.js";
import { discoverService } from "../../discover/service.js";
import { getLegacyConnection } from "../../shared/rpc.js";
import { logger } from "../../shared/logger.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function mcpError(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

async function buildAndAssemble(
  opportunityId: number,
  walletAddress: string,
  amount: string,
  action: "deposit" | "withdraw",
) {
  // Build instructions
  const result = await buildTransaction(
    {
      opportunity_id: opportunityId,
      wallet_address: walletAddress,
      amount,
    },
    action,
  );

  // Assemble main transaction
  const assembled = await assembleTransaction(
    result.instructions,
    walletAddress,
    result.lookupTableAddresses,
  );

  // Assemble setup transactions if any
  let setupTransactions: string[] | undefined;
  if (result.setupInstructionSets?.length) {
    setupTransactions = [];
    for (const setupIxs of result.setupInstructionSets) {
      if (setupIxs.length === 0) continue;
      const setupAssembled = await assembleTransaction(
        setupIxs,
        walletAddress,
        result.lookupTableAddresses,
      );
      setupTransactions.push(setupAssembled.transaction);
    }
  }

  // Build human-readable summary
  const opp = await discoverService.getOpportunityById(opportunityId);
  const oppName = opp?.name ?? `opportunity #${opportunityId}`;
  const protocol = opp?.protocol?.name ?? "unknown protocol";
  const apyStr = opp?.apy_current
    ? ` (~${opp.apy_current.toFixed(1)}% APY)`
    : "";
  const summary =
    action === "deposit"
      ? `Deposit ${amount} into ${oppName} on ${protocol}${apyStr}`
      : `Withdraw ${amount} from ${oppName} on ${protocol}`;

  return {
    transaction: assembled.transaction,
    blockhash: assembled.blockhash,
    lastValidBlockHeight: assembled.lastValidBlockHeight,
    ...(setupTransactions?.length ? { setup_transactions: setupTransactions } : {}),
    summary,
  };
}

export function registerManageTools(server: McpServer) {
  server.tool(
    "build_deposit_tx",
    "Build an unsigned deposit transaction for a yield opportunity. Returns a base64-encoded transaction ready for signing. The transaction expires in ~60 seconds.",
    {
      opportunity_id: z
        .number()
        .int()
        .positive()
        .describe("The yield opportunity ID (from search_yields)"),
      wallet_address: z
        .string()
        .describe("Solana wallet address that will sign and pay fees"),
      amount: z
        .string()
        .describe("Amount to deposit in human-readable format, e.g. '100.5'"),
    },
    async (args) => {
      try {
        const result = await buildAndAssemble(
          args.opportunity_id,
          args.wallet_address,
          args.amount,
          "deposit",
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to build deposit transaction";
        logger.error({ err }, "MCP build_deposit_tx failed");
        return mcpError(message);
      }
    },
  );

  server.tool(
    "build_withdraw_tx",
    "Build an unsigned withdrawal transaction from a yield opportunity. Returns a base64-encoded transaction ready for signing. The transaction expires in ~60 seconds.",
    {
      opportunity_id: z
        .number()
        .int()
        .positive()
        .describe("The yield opportunity ID"),
      wallet_address: z
        .string()
        .describe("Solana wallet address that will sign and pay fees"),
      amount: z
        .string()
        .describe("Amount to withdraw in human-readable format, e.g. '100.5'"),
    },
    async (args) => {
      try {
        const result = await buildAndAssemble(
          args.opportunity_id,
          args.wallet_address,
          args.amount,
          "withdraw",
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to build withdraw transaction";
        logger.error({ err }, "MCP build_withdraw_tx failed");
        return mcpError(message);
      }
    },
  );

  server.tool(
    "submit_transaction",
    "Submit a signed Solana transaction to the network. The transaction must already be signed.",
    {
      signed_transaction: z
        .string()
        .min(1)
        .describe("Base64-encoded signed transaction"),
    },
    async (args) => {
      try {
        const connection = await getLegacyConnection();

        const txBytes = Buffer.from(args.signed_transaction, "base64");
        const signature = await (connection as any).sendRawTransaction(
          txBytes,
          {
            skipPreflight: false,
            maxRetries: 3,
          },
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ signature, status: "submitted" }),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Transaction submission failed";
        logger.error({ err }, "MCP submit_transaction failed");
        return mcpError(message);
      }
    },
  );

  server.tool(
    "get_balance",
    "Get the current deposited balance for a wallet in a specific yield opportunity.",
    {
      opportunity_id: z.number().int().positive().describe("The yield opportunity ID"),
      wallet_address: z.string().describe("Solana wallet address (base58)"),
    },
    async (args) => {
      try {
        const opp = await discoverService.getOpportunityById(args.opportunity_id);
        if (!opp?.protocol?.slug || !opp.deposit_address) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Opportunity not found or missing deposit address" }) }],
            isError: true,
          };
        }
        const adapter = await getAdapter(opp.protocol.slug);
        if (!adapter) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `No adapter for ${opp.protocol.slug}` }) }],
            isError: true,
          };
        }
        if (!adapter.getBalance) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `Balance check not supported for ${opp.protocol.slug}` }) }],
            isError: true,
          };
        }
        const balance = await adapter.getBalance({
          walletAddress: args.wallet_address,
          depositAddress: opp.deposit_address,
          category: opp.category,
          extraData: opp.extra_data ?? {},
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ balance, opportunity: opp.name, protocol: opp.protocol.name }) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Balance check failed";
        logger.error({ err }, "MCP get_balance failed");
        return mcpError(message);
      }
    },
  );

  server.tool(
    "get_withdraw_state",
    "Check withdrawal state for protocols with redemption periods (e.g., Drift's 3-day redeem).",
    {
      opportunity_id: z.number().int().positive().describe("The yield opportunity ID"),
      wallet_address: z.string().describe("Solana wallet address (base58)"),
    },
    async (args) => {
      try {
        const opp = await discoverService.getOpportunityById(args.opportunity_id);
        if (!opp?.protocol?.slug || !opp.deposit_address) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Opportunity not found" }) }],
            isError: true,
          };
        }
        const adapter = await getAdapter(opp.protocol.slug);
        if (!adapter) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `No adapter for ${opp.protocol.slug}` }) }],
            isError: true,
          };
        }
        if (!adapter.getWithdrawState) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `Withdraw state not supported for ${opp.protocol.slug}` }) }],
            isError: true,
          };
        }
        const state = await adapter.getWithdrawState({
          walletAddress: args.wallet_address,
          depositAddress: opp.deposit_address,
          category: opp.category,
          extraData: opp.extra_data ?? {},
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ withdraw_state: state }) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Withdraw state check failed";
        logger.error({ err }, "MCP get_withdraw_state failed");
        return mcpError(message);
      }
    },
  );

  server.tool(
    "get_swap_quote",
    "Get a Jupiter swap quote for exchanging one token for another on Solana.",
    {
      input_mint: z.string().describe("Input token mint address"),
      output_mint: z.string().describe("Output token mint address"),
      amount: z.string().describe("Amount in smallest units (lamports for SOL, etc.)"),
      slippage_bps: z.number().int().min(1).max(500).optional().default(50).describe("Slippage tolerance in basis points (default: 50 = 0.5%)"),
      taker: z.string().describe("Wallet address of the taker"),
    },
    async (args) => {
      try {
        const quote = await getSwapQuote({
          inputMint: args.input_mint,
          outputMint: args.output_mint,
          amount: args.amount,
          slippageBps: args.slippage_bps,
          taker: args.taker,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(quote, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Swap quote failed";
        logger.error({ err }, "MCP get_swap_quote failed");
        return mcpError(message);
      }
    },
  );

  server.tool(
    "build_swap_tx",
    "Build an unsigned Jupiter swap transaction. Returns a base64-encoded transaction ready for signing.",
    {
      wallet_address: z.string().describe("Solana wallet address that will sign"),
      input_mint: z.string().describe("Input token mint address"),
      output_mint: z.string().describe("Output token mint address"),
      amount: z.string().describe("Amount in smallest units"),
      slippage_bps: z.number().int().min(1).max(500).optional().default(50).describe("Slippage tolerance in basis points"),
    },
    async (args) => {
      try {
        guardWalletValid(args.wallet_address);

        const result = await buildSwapInstructions({
          inputMint: args.input_mint,
          outputMint: args.output_mint,
          amount: args.amount,
          slippageBps: args.slippage_bps,
          taker: args.wallet_address,
        });

        const serialized = serializeResult(result);
        guardProgramWhitelist(serialized.instructions);

        const assembled = await assembleTransaction(
          serialized.instructions,
          args.wallet_address,
          serialized.lookupTableAddresses,
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            transaction: assembled.transaction,
            blockhash: assembled.blockhash,
            lastValidBlockHeight: assembled.lastValidBlockHeight,
            summary: `Swap ${args.amount} (${args.input_mint.slice(0, 8)}...) → ${args.output_mint.slice(0, 8)}...`,
          }, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Swap build failed";
        logger.error({ err }, "MCP build_swap_tx failed");
        return mcpError(message);
      }
    },
  );
}
