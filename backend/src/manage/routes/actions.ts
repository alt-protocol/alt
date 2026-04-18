/**
 * Solana Actions (Blinks) endpoints.
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
import { buildTransaction } from "../services/tx-builder.js";
import { assembleTransaction } from "../services/tx-assembler.js";
import { discoverService } from "../../discover/service.js";
import { logger } from "../../shared/logger.js";

const ICON_URL = process.env.ACTIONS_ICON_URL || "https://akashi.app/icon.png";

interface ActionGetQuery {
  opportunity_id: string;
}

interface ActionPostQuery {
  opportunity_id: string;
  amount: string;
  wallet?: string;
  leverage?: string;
  slippageBps?: string;
  isClosingPosition?: string;
  action?: string;
  position_id?: string;
  deposit_token?: string;
}

interface ActionPostBody {
  account: string; // Solana Actions spec sends wallet address as "account"
}

/** Parse multiply-specific query params into extra_data for buildTransaction. */
function parseExtraData(query: ActionPostQuery): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  if (query.leverage) extra.leverage = Number(query.leverage);
  if (query.slippageBps) extra.slippageBps = Number(query.slippageBps);
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
  // Solana Actions CORS — must allow all origins
  app.addHook("onRequest", (_request, reply, done) => {
    void reply.header("Access-Control-Allow-Origin", "*");
    void reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    void reply.header("Access-Control-Allow-Headers", "Content-Type");
    done();
  });

  // OPTIONS preflight
  app.options("/actions/*", async (_request, reply) => {
    return reply.status(204).send();
  });

  // -----------------------------------------------------------------------
  // GET /actions/deposit — Action metadata
  // -----------------------------------------------------------------------
  app.get<{ Querystring: ActionGetQuery }>(
    "/actions/deposit",
    async (request) => {
      const opportunityId = Number(request.query.opportunity_id);
      if (!opportunityId) return { error: "opportunity_id required" };

      const opp = await discoverService.getOpportunityById(opportunityId);
      if (!opp) return { error: "Opportunity not found" };

      const apyStr = opp.apy_current
        ? ` Current APY: ${opp.apy_current.toFixed(1)}%`
        : "";

      return {
        icon: ICON_URL,
        title: `Deposit into ${opp.name}`,
        description: `Deposit into ${opp.name} on ${opp.protocol?.name ?? "Solana"}.${apyStr}`,
        label: "Deposit",
        links: {
          actions: [
            {
              label: "Deposit",
              href: `/api/manage/actions/deposit?opportunity_id=${opportunityId}&amount={amount}`,
              parameters: [
                { name: "amount", label: "Amount" },
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
  app.post<{ Querystring: ActionPostQuery; Body: ActionPostBody }>(
    "/actions/deposit",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const opportunityId = Number(request.query.opportunity_id);
      const amount = request.query.amount;
      const walletAddress =
        (request.body as ActionPostBody)?.account ?? request.query.wallet;

      if (!opportunityId || !amount || !walletAddress) {
        return { error: "opportunity_id, amount, and account are required" };
      }

      try {
        const extraData = parseExtraData(request.query);
        const { assembled } = await buildAndAssembleForAction(
          opportunityId,
          walletAddress,
          amount,
          "deposit",
          extraData,
        );

        const opp = await discoverService.getOpportunityById(opportunityId);
        return {
          transaction: assembled.transaction,
          message: `Deposit ${amount} into ${opp?.name ?? `opportunity #${opportunityId}`}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to build transaction";
        logger.error({ err, opportunityId, amount }, "Actions deposit failed");
        return { error: msg };
      }
    },
  );

  // -----------------------------------------------------------------------
  // GET /actions/withdraw — Action metadata
  // -----------------------------------------------------------------------
  app.get<{ Querystring: ActionGetQuery }>(
    "/actions/withdraw",
    async (request) => {
      const opportunityId = Number(request.query.opportunity_id);
      if (!opportunityId) return { error: "opportunity_id required" };

      const opp = await discoverService.getOpportunityById(opportunityId);
      if (!opp) return { error: "Opportunity not found" };

      return {
        icon: ICON_URL,
        title: `Withdraw from ${opp.name}`,
        description: `Withdraw from ${opp.name} on ${opp.protocol?.name ?? "Solana"}.`,
        label: "Withdraw",
        links: {
          actions: [
            {
              label: "Withdraw",
              href: `/api/manage/actions/withdraw?opportunity_id=${opportunityId}&amount={amount}`,
              parameters: [
                { name: "amount", label: "Amount" },
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
  app.post<{ Querystring: ActionPostQuery; Body: ActionPostBody }>(
    "/actions/withdraw",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const opportunityId = Number(request.query.opportunity_id);
      const amount = request.query.amount;
      const walletAddress =
        (request.body as ActionPostBody)?.account ?? request.query.wallet;

      if (!opportunityId || !amount || !walletAddress) {
        return { error: "opportunity_id, amount, and account are required" };
      }

      try {
        const extraData = parseExtraData(request.query);
        const { assembled } = await buildAndAssembleForAction(
          opportunityId,
          walletAddress,
          amount,
          "withdraw",
          extraData,
        );

        const opp = await discoverService.getOpportunityById(opportunityId);
        return {
          transaction: assembled.transaction,
          message: `Withdraw ${amount} from ${opp?.name ?? `opportunity #${opportunityId}`}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to build transaction";
        logger.error({ err, opportunityId, amount }, "Actions withdraw failed");
        return { error: msg };
      }
    },
  );
}
