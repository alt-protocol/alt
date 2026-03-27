import type { FastifyInstance } from "fastify";
import { buildTransaction } from "../services/tx-builder.js";
import { simulateTransaction } from "../services/tx-preview.js";
import { logger } from "../../shared/logger.js";
import { BuildTxBody, SubmitTxBody } from "./schemas.js";

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

  // POST /tx/submit — submit signed transaction via Helius RPC
  app.post(
    "/tx/submit",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
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
}
