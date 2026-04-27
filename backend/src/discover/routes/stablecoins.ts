import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NotFoundError } from "../../shared/error-handler.js";
import { discoverService } from "../service.js";

const PriceHistoryQuery = z.object({
  period: z.enum(["7d", "30d"]).default("7d"),
});

export async function stablecoinsRoutes(app: FastifyInstance) {
  // -----------------------------------------------------------------------
  // GET /stablecoins/peg-stats
  // -----------------------------------------------------------------------
  app.get("/stablecoins/peg-stats", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async () => {
      const data = await discoverService.getPegStats();
      return { data };
    },
  });

  // -----------------------------------------------------------------------
  // GET /stablecoins/:symbol/price-history
  // -----------------------------------------------------------------------
  app.get<{ Params: { symbol: string } }>("/stablecoins/:symbol/price-history", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (request) => {
      const { symbol } = request.params;
      const q = PriceHistoryQuery.parse(request.query);

      const result = await discoverService.getStablecoinPriceHistory(
        symbol,
        q.period,
      );

      if (!result) {
        throw new NotFoundError(`Stablecoin ${symbol} not tracked`);
      }

      return result;
    },
  });
}
