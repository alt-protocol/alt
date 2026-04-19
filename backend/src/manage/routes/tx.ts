import type { FastifyInstance } from "fastify";
import { buildTransaction } from "../services/tx-builder.js";
import { simulateTransaction } from "../services/tx-preview.js";
import { discoverService } from "../../discover/service.js";
import { getAdapter } from "../protocols/index.js";
import { getMultiplyStats } from "../protocols/kamino.js";
import { getJupiterMultiplyStats } from "../protocols/jupiter.js";
import { authHook } from "../../shared/auth.js";
import { logger } from "../../shared/logger.js";
import { BuildTxBody, SubmitTxBody, BalanceBody, WalletBalanceBody, WithdrawStateBody } from "./schemas.js";
import { fetchWalletBalance } from "../services/wallet-balance.js";
import { cachedAsync, bustCacheKey } from "../../shared/utils.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function txRoutes(app: FastifyInstance) {
  // POST /tx/build-deposit
  app.post(
    "/tx/build-deposit",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = BuildTxBody.parse(request.body);

      const result = await buildTransaction(
        {
          opportunity_id: body.opportunity_id,
          wallet_address: body.wallet_address,
          amount: body.amount,
          extra_data: body.extra_data,
        },
        "deposit",
      );

      // Optional simulation
      if (body.simulate) {
        const simulation = await simulateTransaction(
          result.instructions,
          body.wallet_address,
          result.lookupTableAddresses,
        );
        return reply.send({ ...result, simulation });
      }

      return reply.send(result);
    },
  );

  // POST /tx/build-withdraw
  app.post(
    "/tx/build-withdraw",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = BuildTxBody.parse(request.body);

      const result = await buildTransaction(
        {
          opportunity_id: body.opportunity_id,
          wallet_address: body.wallet_address,
          amount: body.amount,
          extra_data: body.extra_data,
        },
        "withdraw",
      );

      // Optional simulation
      if (body.simulate) {
        const simulation = await simulateTransaction(
          result.instructions,
          body.wallet_address,
          result.lookupTableAddresses,
        );
        return reply.send({ ...result, simulation });
      }

      return reply.send(result);
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

  // POST /wallet-balance — on-chain wallet token balance (cached 15s server-side)
  app.post(
    "/wallet-balance",
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

  // POST /balance — fetch protocol-specific vault/position balance
  app.post(
    "/balance",
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

  // POST /withdraw-state — check multi-step withdrawal state (e.g. Drift redeem period)
  app.post(
    "/withdraw-state",
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
}
