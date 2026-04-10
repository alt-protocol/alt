import type { FastifyInstance } from "fastify";
import { sql, eq, gte, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/connection.js";
import { stablecoinPegStats, stablecoinPriceSnapshots } from "../db/schema.js";
import { numOrNull } from "../../shared/utils.js";
import { NotFoundError } from "../../shared/error-handler.js";

const PriceHistoryQuery = z.object({
  period: z.enum(["7d", "30d"]).default("7d"),
});

const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30 };

export async function stablecoinsRoutes(app: FastifyInstance) {
  // -----------------------------------------------------------------------
  // GET /stablecoins/peg-stats
  // -----------------------------------------------------------------------
  app.get("/stablecoins/peg-stats", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async () => {
      const rows = await db
        .select()
        .from(stablecoinPegStats)
        .orderBy(asc(stablecoinPegStats.symbol));

      return {
        data: rows.map((r) => ({
          mint: r.mint,
          symbol: r.symbol,
          price_current: numOrNull(r.price_current),
          peg_type: r.peg_type,
          peg_target: numOrNull(r.peg_target),
          peg_adherence_7d: numOrNull(r.peg_adherence_7d),
          max_deviation_7d: numOrNull(r.max_deviation_7d),
          min_price_7d: numOrNull(r.min_price_7d),
          max_price_7d: numOrNull(r.max_price_7d),
          volatility_7d: numOrNull(r.volatility_7d),
          snapshot_count_7d: r.snapshot_count_7d ?? 0,
          peg_adherence_30d: numOrNull(r.peg_adherence_30d),
          max_deviation_30d: numOrNull(r.max_deviation_30d),
          min_price_30d: numOrNull(r.min_price_30d),
          max_price_30d: numOrNull(r.max_price_30d),
          volatility_30d: numOrNull(r.volatility_30d),
          snapshot_count_30d: r.snapshot_count_30d ?? 0,
          liquidity_usd: numOrNull(r.liquidity_usd),
          updated_at: r.updated_at,
        })),
      };
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
      const days = PERIOD_DAYS[q.period] ?? 7;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Verify stablecoin exists in stats
      const exists = await db
        .select({ mint: stablecoinPegStats.mint, peg_target: stablecoinPegStats.peg_target })
        .from(stablecoinPegStats)
        .where(eq(stablecoinPegStats.symbol, symbol.toUpperCase()))
        .limit(1);

      if (exists.length === 0) {
        throw new NotFoundError(`Stablecoin ${symbol} not tracked`);
      }

      // For 30d, downsample to hourly via DISTINCT ON
      const mint = exists[0].mint;
      let snapshots;
      if (days > 7) {
        snapshots = await db.execute(sql`
          SELECT DISTINCT ON (date_trunc('hour', snapshot_at))
            price_usd::text AS price_usd,
            snapshot_at
          FROM ${stablecoinPriceSnapshots}
          WHERE mint = ${mint}
            AND snapshot_at >= ${since}
          ORDER BY date_trunc('hour', snapshot_at), snapshot_at DESC
        `);
      } else {
        snapshots = await db.execute(sql`
          SELECT price_usd::text AS price_usd, snapshot_at
          FROM ${stablecoinPriceSnapshots}
          WHERE mint = ${mint}
            AND snapshot_at >= ${since}
          ORDER BY snapshot_at ASC
        `);
      }

      const rows = (snapshots as unknown as { rows: { price_usd: string; snapshot_at: Date }[] }).rows;

      return {
        data: rows.map((r) => ({
          snapshot_at: r.snapshot_at,
          price_usd: numOrNull(r.price_usd),
        })),
        meta: {
          total: rows.length,
          symbol: symbol.toUpperCase(),
          peg_target: numOrNull(exists[0].peg_target),
        },
      };
    },
  });
}
