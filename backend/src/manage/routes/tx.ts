import type { FastifyInstance } from "fastify";
import { buildTransaction } from "../services/tx-builder.js";
import { simulateTransaction } from "../services/tx-preview.js";
import { discoverService } from "../../discover/service.js";
import { getAdapter } from "../protocols/index.js";
import { authHook } from "../../shared/auth.js";
import { logger } from "../../shared/logger.js";
import { BuildTxBody, SubmitTxBody, BalanceBody, WithdrawStateBody } from "./schemas.js";

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

  // POST /balance — fetch protocol-specific vault/position balance
  app.post(
    "/balance",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = BalanceBody.parse(request.body);

      const opp = await discoverService.getOpportunityById(body.opportunity_id);
      if (!opp || !opp.protocol?.slug || !opp.deposit_address) {
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
}
