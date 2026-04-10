import type { FastifyInstance } from "fastify";
import { getSwapQuote, buildSwapInstructions } from "../services/jupiter-swap.js";
import { serializeResult } from "../services/instruction-serializer.js";
import { guardWalletValid, guardProgramWhitelist } from "../services/guards.js";
import { logger } from "../../shared/logger.js";
import { SwapQuoteQuery, BuildSwapBody } from "./swap-schemas.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function swapRoutes(app: FastifyInstance) {
  // GET /swap/quote
  app.get(
    "/swap/quote",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const query = SwapQuoteQuery.parse(request.query);

      const quote = await getSwapQuote({
        inputMint: query.inputMint,
        outputMint: query.outputMint,
        amount: query.amount,
        slippageBps: query.slippageBps,
        taker: query.taker,
      });

      return reply.send(quote);
    },
  );

  // POST /tx/build-swap
  app.post(
    "/tx/build-swap",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = BuildSwapBody.parse(request.body);
      guardWalletValid(body.wallet_address);

      const result = await buildSwapInstructions({
        inputMint: body.input_mint,
        outputMint: body.output_mint,
        amount: body.amount,
        slippageBps: body.slippage_bps,
        taker: body.wallet_address,
      });

      const serialized = serializeResult(result);

      // Verify all programs are whitelisted
      guardProgramWhitelist(serialized.instructions);

      logger.info(
        {
          wallet: body.wallet_address.slice(0, 8),
          inputMint: body.input_mint.slice(0, 8),
          outputMint: body.output_mint.slice(0, 8),
          ixCount: serialized.instructions.length,
        },
        "Swap transaction built",
      );

      return reply.send(serialized);
    },
  );
}
