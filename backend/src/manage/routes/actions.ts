/**
 * Solana Actions (Blinks) endpoints — spec v2.
 *
 * These follow the Solana Actions spec so wallets (Phantom, Solflare) can
 * display a signing UI when users tap a `solana-action:` link.
 *
 * GET  /actions/deposit  → action metadata
 * POST /actions/deposit  → unsigned base64 transaction
 * GET  /actions/withdraw → action metadata
 * POST /actions/withdraw → unsigned base64 transaction
 *
 * Reuses buildTransaction + assembleTransaction from tx-builder/tx-assembler.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildTransaction } from "../services/tx-builder.js";
import { assembleTransaction } from "../services/tx-assembler.js";
import { discoverService } from "../../discover/service.js";
import { APP_URL } from "../../shared/constants.js";
import { logger } from "../../shared/logger.js";

const ICON_URL = process.env.ACTIONS_ICON_URL || "https://akashi.app/icon.png";

/** Solana mainnet chain ID per CAIP-2. */
const SOLANA_MAINNET_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const ACTION_VERSION = "2.6.1";

// ---------------------------------------------------------------------------
// Zod schemas for Actions routes
// ---------------------------------------------------------------------------

const ActionGetQuery = z.object({
  opportunity_id: z.coerce.number().int().positive(),
  amount: z.string().optional(),
  leverage: z.coerce.number().optional(),
  deposit_token: z.string().optional(),
  wallet: z.string().optional(),
  slippageBps: z.coerce.number().int().optional(),
  isClosingPosition: z.string().optional(),
  action: z.string().optional(),
  position_id: z.string().optional(),
});

const ActionPostQuery = z.object({
  opportunity_id: z.coerce.number().int().positive(),
  amount: z.string().min(1),
  wallet: z.string().optional(),
  leverage: z.coerce.number().optional(),
  slippageBps: z.coerce.number().int().optional(),
  isClosingPosition: z.string().optional(),
  action: z.string().optional(),
  position_id: z.string().optional(),
  deposit_token: z.string().optional(),
});

const ActionPostBody = z.object({
  account: z.string().min(1), // Solana Actions spec sends wallet address as "account"
});

/** Parse multiply-specific query params into extra_data for buildTransaction. */
function parseExtraData(query: z.infer<typeof ActionPostQuery>): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  if (query.leverage) extra.leverage = query.leverage;
  if (query.slippageBps) extra.slippageBps = query.slippageBps;
  if (query.isClosingPosition === "true") extra.isClosingPosition = true;
  if (query.action) extra.action = query.action;
  if (query.position_id) extra.position_id = query.position_id;
  if (query.deposit_token) extra.deposit_token = query.deposit_token;
  return Object.keys(extra).length > 0 ? extra : undefined;
}

async function buildAndAssembleForAction(
  opportunityId: number,
  walletAddress: string,
  amount: string,
  action: "deposit" | "withdraw",
  extraData?: Record<string, unknown>,
) {
  const result = await buildTransaction(
    {
      opportunity_id: opportunityId,
      wallet_address: walletAddress,
      amount,
      extra_data: extraData,
    },
    action,
  );

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

  return { assembled, setupTransactions };
}

export async function actionsRoutes(app: FastifyInstance) {
  /** Set Solana Actions spec headers on all responses. */
  function setActionHeaders(reply: import("fastify").FastifyReply) {
    void reply.header("Access-Control-Allow-Origin", "*");
    void reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    void reply.header("Access-Control-Allow-Headers", "Content-Type,Authorization,Accept-Encoding");
    void reply.header("Access-Control-Expose-Headers", "X-Action-Version,X-Blockchain-Ids");
    void reply.header("X-Action-Version", ACTION_VERSION);
    void reply.header("X-Blockchain-Ids", SOLANA_MAINNET_ID);
  }

  app.addHook("onRequest", async (_request, reply) => {
    setActionHeaders(reply);
  });

  // OPTIONS preflight — explicit handlers override @fastify/cors
  app.options("/actions/deposit", async (_request, reply) => {
    setActionHeaders(reply);
    return reply.status(204).send();
  });
  app.options("/actions/withdraw", async (_request, reply) => {
    setActionHeaders(reply);
    return reply.status(204).send();
  });

  // -----------------------------------------------------------------------
  // GET /actions/deposit — Action metadata
  // -----------------------------------------------------------------------
  app.get(
    "/actions/deposit",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const query = ActionGetQuery.parse(request.query);
      const opportunityId = query.opportunity_id;

      const opp = await discoverService.getOpportunityById(opportunityId);
      if (!opp) return reply.status(404).send({ message: "Opportunity not found" });

      const apyStr = opp.apy_current
        ? ` Current APY: ${opp.apy_current.toFixed(1)}%`
        : "";

      // Resolve token symbol from deposit_token role + opportunity data
      const extra = opp.extra_data as Record<string, unknown> | null;
      let tokenSymbol = opp.tokens?.[0] ?? "";
      if (query.deposit_token === "collateral") {
        tokenSymbol = (extra?.collateral_symbol as string) ?? opp.tokens?.[0] ?? "";
      } else if (query.deposit_token === "debt") {
        tokenSymbol = (extra?.debt_symbol as string) ?? opp.tokens?.[1] ?? "";
      }

      const amountStr = query.amount ? `${query.amount} ${tokenSymbol} ` : "";
      const leverageStr = query.leverage ? ` at ${query.leverage}x leverage` : "";

      return {
        type: "action",
        icon: ICON_URL,
        title: `Deposit ${amountStr}into ${opp.name}${leverageStr}`,
        description: `Deposit ${amountStr}into ${opp.name} on ${opp.protocol?.name ?? "Solana"}.${leverageStr}${apyStr}`,
        label: "Deposit",
        links: {
          actions: [
            {
              type: "transaction",
              label: "Deposit",
              href: `${APP_URL}/api/manage/actions/deposit?opportunity_id=${opportunityId}&amount={amount}`,
              parameters: [
                { name: "amount", label: "Amount", type: "number", required: true },
              ],
            },
          ],
        },
      };
    },
  );

  // -----------------------------------------------------------------------
  // POST /actions/deposit — Build unsigned transaction
  // -----------------------------------------------------------------------
  app.post(
    "/actions/deposit",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const query = ActionPostQuery.parse(request.query);
      const body = ActionPostBody.parse(request.body);
      const walletAddress = body.account ?? query.wallet;

      if (!walletAddress) {
        return reply.status(400).send({ message: "account (body) or wallet (query) is required" });
      }

      try {
        const extraData = parseExtraData(query);
        const { assembled, setupTransactions } = await buildAndAssembleForAction(
          query.opportunity_id,
          walletAddress,
          query.amount,
          "deposit",
          extraData,
        );

        const opp = await discoverService.getOpportunityById(query.opportunity_id);
        return {
          type: "transaction",
          transaction: assembled.transaction,
          message: `Deposit ${query.amount} into ${opp?.name ?? `opportunity #${query.opportunity_id}`}`,
          ...(setupTransactions?.length ? { setup_transactions: setupTransactions } : {}),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to build transaction";
        logger.error({ err, opportunityId: query.opportunity_id, amount: query.amount }, "Actions deposit failed");
        return reply.status(422).send({ message: msg });
      }
    },
  );

  // -----------------------------------------------------------------------
  // GET /actions/withdraw — Action metadata
  // -----------------------------------------------------------------------
  app.get(
    "/actions/withdraw",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const query = ActionGetQuery.parse(request.query);
      const opportunityId = query.opportunity_id;

      const opp = await discoverService.getOpportunityById(opportunityId);
      if (!opp) return reply.status(404).send({ message: "Opportunity not found" });

      const amountStr = query.amount ? `${query.amount} ` : "";
      const closingStr = query.isClosingPosition === "true" ? " (close position)" : "";

      return {
        type: "action",
        icon: ICON_URL,
        title: `Withdraw ${amountStr}from ${opp.name}${closingStr}`,
        description: `Withdraw ${amountStr}from ${opp.name} on ${opp.protocol?.name ?? "Solana"}.${closingStr}`,
        label: "Withdraw",
        links: {
          actions: [
            {
              type: "transaction",
              label: "Withdraw",
              href: `${APP_URL}/api/manage/actions/withdraw?opportunity_id=${opportunityId}&amount={amount}`,
              parameters: [
                { name: "amount", label: "Amount", type: "number", required: true },
              ],
            },
          ],
        },
      };
    },
  );

  // -----------------------------------------------------------------------
  // POST /actions/withdraw — Build unsigned transaction
  // -----------------------------------------------------------------------
  app.post(
    "/actions/withdraw",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const query = ActionPostQuery.parse(request.query);
      const body = ActionPostBody.parse(request.body);
      const walletAddress = body.account ?? query.wallet;

      if (!walletAddress) {
        return reply.status(400).send({ message: "account (body) or wallet (query) is required" });
      }

      try {
        const extraData = parseExtraData(query);
        const { assembled, setupTransactions } = await buildAndAssembleForAction(
          query.opportunity_id,
          walletAddress,
          query.amount,
          "withdraw",
          extraData,
        );

        const opp = await discoverService.getOpportunityById(query.opportunity_id);
        return {
          type: "transaction",
          transaction: assembled.transaction,
          message: `Withdraw ${query.amount} from ${opp?.name ?? `opportunity #${query.opportunity_id}`}`,
          ...(setupTransactions?.length ? { setup_transactions: setupTransactions } : {}),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to build transaction";
        logger.error({ err, opportunityId: query.opportunity_id, amount: query.amount }, "Actions withdraw failed");
        return reply.status(422).send({ message: msg });
      }
    },
  );
}
