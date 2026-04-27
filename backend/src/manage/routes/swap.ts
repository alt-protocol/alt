import type { FastifyInstance } from "fastify";
import { getSwapQuote, buildSwapInstructions } from "../services/jupiter-swap.js";
import { serializeResult } from "../services/instruction-serializer.js";
import { assembleTransaction } from "../services/tx-assembler.js";
import { guardWalletValid, guardProgramWhitelist, guardPriceImpact } from "../services/guards.js";
import { logger } from "../../shared/logger.js";
import { SwapQuoteQuery, BuildSwapBody } from "./swap-schemas.js";
import { FormatQuery } from "./schemas.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function swapRoutes(app: FastifyInstance) {
  // GET /swap/quote
  app.get(
    "/swap/quote",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const query = SwapQuoteQuery.parse(request.query);

      const quote = await getSwapQuote({
        inputMint: query.input_mint,
        outputMint: query.output_mint,
        amount: query.amount,
        slippageBps: query.slippage_bps,
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
      const { format } = FormatQuery.parse(request.query);
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

      // Price impact guard (post-build, pre-response)
      const priceImpactPct = (serialized.metadata?.priceImpactPct as number) ?? 0;
      const impact = guardPriceImpact(priceImpactPct);
      if (impact.warning) {
        serialized.metadata = {
          ...serialized.metadata,
          priceImpactWarning: true,
        };
      }

      logger.info(
        {
          wallet: body.wallet_address.slice(0, 8),
          inputMint: body.input_mint.slice(0, 8),
          outputMint: body.output_mint.slice(0, 8),
          ixCount: serialized.instructions.length,
          priceImpactPct,
        },
        "Swap transaction built",
      );

      if (format === "assembled") {
        const assembled = await assembleTransaction(
          serialized.instructions,
          body.wallet_address,
          serialized.lookupTableAddresses,
        );
        return reply.send({
          transaction: assembled.transaction,
          blockhash: assembled.blockhash,
          lastValidBlockHeight: assembled.lastValidBlockHeight,
          summary: `Swap ${body.amount} (${body.input_mint.slice(0, 8)}...) → ${body.output_mint.slice(0, 8)}...`,
          metadata: serialized.metadata,
        });
      }

      return reply.send(serialized);
    },
  );
}
