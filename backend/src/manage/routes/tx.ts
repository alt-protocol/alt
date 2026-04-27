import type { FastifyInstance } from "fastify";
import { buildTransaction } from "../services/tx-builder.js";
import { simulateTransaction } from "../services/tx-preview.js";
import { assembleTransaction } from "../services/tx-assembler.js";
import { generateSignOptions } from "../services/sign-options.js";
import { discoverService } from "../../discover/service.js";
import { getAdapter } from "../protocols/index.js";
import { getMultiplyStats } from "../protocols/kamino.js";
import { getJupiterMultiplyStats } from "../protocols/jupiter.js";
import { authHook } from "../../shared/auth.js";
import { logger } from "../../shared/logger.js";
import { BuildTxBody, FormatQuery, SubmitTxBody, BalanceBody, WalletBalanceBody, WithdrawStateBody, PriceImpactBody } from "./schemas.js";
import { fetchWalletBalance } from "../services/wallet-balance.js";
import { cachedAsync, bustCacheKey } from "../../shared/utils.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Assemble a rich response for format=assembled: base64 tx + sign options + summary.
 */
async function assembleRichResponse(
  buildResult: { instructions: any[]; lookupTableAddresses?: string[]; setupInstructionSets?: any[][] },
  walletAddress: string,
  opportunityId: number,
  amount: string,
  action: "deposit" | "withdraw",
  extraData?: Record<string, unknown>,
  simulate?: boolean,
) {
  const assembled = await assembleTransaction(
    buildResult.instructions,
    walletAddress,
    buildResult.lookupTableAddresses,
  );

  let setupTransactions: string[] | undefined;
  if (buildResult.setupInstructionSets?.length) {
    setupTransactions = [];
    for (const setupIxs of buildResult.setupInstructionSets) {
      if (setupIxs.length === 0) continue;
      const setupAssembled = await assembleTransaction(setupIxs, walletAddress, buildResult.lookupTableAddresses);
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

  const result: Record<string, unknown> = {
    transaction: assembled.transaction,
    blockhash: assembled.blockhash,
    lastValidBlockHeight: assembled.lastValidBlockHeight,
    ...(setupTransactions?.length ? { setup_transactions: setupTransactions } : {}),
    summary,
    sign,
  };

  if (simulate) {
    result.simulation = await simulateTransaction(
      buildResult.instructions,
      walletAddress,
      buildResult.lookupTableAddresses,
    );
  }

  return result;
}

export async function txRoutes(app: FastifyInstance) {
  // POST /tx/build-deposit
  app.post(
    "/tx/build-deposit",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = BuildTxBody.parse(request.body);
      const { format } = FormatQuery.parse(request.query);

      try {
        const result = await buildTransaction(
          {
            opportunity_id: body.opportunity_id,
            wallet_address: body.wallet_address,
            amount: body.amount,
            extra_data: body.extra_data,
          },
          "deposit",
        );

        if (format === "assembled") {
          return reply.send(await assembleRichResponse(
            result, body.wallet_address, body.opportunity_id, body.amount, "deposit", body.extra_data, body.simulate,
          ));
        }

        if (body.simulate) {
          const simulation = await simulateTransaction(
            result.instructions,
            body.wallet_address,
            result.lookupTableAddresses,
          );
          return reply.send({ ...result, simulation });
        }

        return reply.send(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to build deposit transaction";
        logger.error({ err, opportunityId: body.opportunity_id, amount: body.amount }, "build-deposit failed");
        const statusCode = (err as any)?.statusCode ?? 422;
        return reply.status(statusCode).send({ message: msg });
      }
    },
  );

  // POST /tx/build-withdraw
  app.post(
    "/tx/build-withdraw",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = BuildTxBody.parse(request.body);
      const { format } = FormatQuery.parse(request.query);

      try {
        const result = await buildTransaction(
          {
            opportunity_id: body.opportunity_id,
            wallet_address: body.wallet_address,
            amount: body.amount,
            extra_data: body.extra_data,
          },
          "withdraw",
        );

        if (format === "assembled") {
          return reply.send(await assembleRichResponse(
            result, body.wallet_address, body.opportunity_id, body.amount, "withdraw", body.extra_data, body.simulate,
          ));
        }

        if (body.simulate) {
          const simulation = await simulateTransaction(
            result.instructions,
            body.wallet_address,
            result.lookupTableAddresses,
          );
          return reply.send({ ...result, simulation });
        }

        return reply.send(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to build withdraw transaction";
        logger.error({ err, opportunityId: body.opportunity_id, amount: body.amount }, "build-withdraw failed");
        const statusCode = (err as any)?.statusCode ?? 422;
        return reply.status(statusCode).send({ message: msg });
      }
    },
  );

  // POST /tx/submit — submit signed transaction via Helius RPC (API key required)
  app.post(
    "/tx/submit",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, preHandler: [authHook] },
    async (request, reply) => {
      const body = SubmitTxBody.parse(request.body);

      try {
        const web3 = await import("@solana/web3.js");
        const connection = new web3.Connection(process.env.HELIUS_RPC_URL!);

        const txBytes = Buffer.from(body.signed_transaction, "base64");
        const signature = await connection.sendRawTransaction(txBytes, {
          skipPreflight: false,
          maxRetries: 3,
        });

        logger.info({ signature: signature.slice(0, 16) + "..." }, "Transaction submitted");

        return reply.send({
          signature,
          status: "submitted",
        });
      } catch (err: any) {
        logger.error({ err }, "Transaction submission failed");
        return reply.status(400).send({
          error: err.message ?? "Transaction submission failed",
        });
      }
    },
  );

  // POST /tx/wallet-balance — on-chain wallet token balance (cached 15s server-side)
  app.post(
    "/tx/wallet-balance",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = WalletBalanceBody.parse(request.body);
      const cacheKey = `wallet_bal_${body.wallet_address}_${body.mint}`;
      if (body.fresh) bustCacheKey(cacheKey);
      const balance = await cachedAsync(
        cacheKey,
        15_000,
        () => fetchWalletBalance(body.wallet_address, body.mint),
      );
      return reply.send({ balance });
    },
  );

  // POST /tx/balance — fetch protocol-specific vault/position balance
  app.post(
    "/tx/balance",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = BalanceBody.parse(request.body);

      const opp = await discoverService.getOpportunityById(body.opportunity_id);
      if (!opp || !opp.protocol?.slug || !opp.deposit_address) {
        logger.warn(
          { opportunityId: body.opportunity_id, hasOpp: !!opp, slug: opp?.protocol?.slug, depositAddr: opp?.deposit_address?.slice(0, 12) },
          "Balance: opportunity missing required fields",
        );
        return reply.send({ balance: null });
      }

      const adapter = await getAdapter(opp.protocol.slug);
      if (!adapter?.getBalance) return reply.send({ balance: null });

      const balance = await adapter.getBalance({
        walletAddress: body.wallet_address,
        depositAddress: opp.deposit_address,
        category: opp.category,
        extraData: opp.extra_data ?? undefined,
      });

      return reply.send({ balance });
    },
  );

  // POST /tx/withdraw-state — check multi-step withdrawal state (e.g. Drift redeem period)
  app.post(
    "/tx/withdraw-state",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = WithdrawStateBody.parse(request.body);

      const opp = await discoverService.getOpportunityById(body.opportunity_id);
      if (!opp || !opp.protocol?.slug || !opp.deposit_address) {
        return reply.send(null);
      }

      const adapter = await getAdapter(opp.protocol.slug);
      if (!adapter?.getWithdrawState) return reply.send(null);

      const state = await adapter.getWithdrawState({
        walletAddress: body.wallet_address,
        depositAddress: opp.deposit_address,
        category: opp.category,
        extraData: opp.extra_data ?? undefined,
      });

      return reply.send(state);
    },
  );

  // POST /tx/position-stats — on-chain multiply position stats
  app.post(
    "/tx/position-stats",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = BalanceBody.parse(request.body);

      const opp = await discoverService.getOpportunityById(body.opportunity_id);
      if (!opp?.extra_data || opp.category !== "multiply") {
        return reply.send(null);
      }

      const extra = { ...(opp.extra_data as Record<string, unknown>), ...body.extra_data };
      const stats = opp.protocol?.slug === "jupiter"
        ? await getJupiterMultiplyStats(body.wallet_address, extra)
        : await getMultiplyStats(body.wallet_address, extra);

      return reply.send(stats);
    },
  );

  // POST /tx/price-impact — pre-flight price impact estimation (protocol-agnostic)
  app.post(
    "/tx/price-impact",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = PriceImpactBody.parse(request.body);

      const opp = await discoverService.getOpportunityById(body.opportunity_id);
      if (!opp?.protocol?.slug || !opp.deposit_address || opp.category !== "multiply") {
        return reply.send(null);
      }

      const adapter = await getAdapter(opp.protocol.slug);
      if (!adapter?.getPriceImpact) return reply.send(null);

      try {
        const result = await adapter.getPriceImpact({
          walletAddress: body.wallet_address,
          depositAddress: opp.deposit_address,
          category: opp.category,
          amount: body.amount,
          direction: body.direction,
          extraData: { ...(opp.extra_data ?? {}), ...(body.extra_data ?? {}) },
        });
        return reply.send(result);
      } catch {
        return reply.send(null);
      }
    },
  );
}
