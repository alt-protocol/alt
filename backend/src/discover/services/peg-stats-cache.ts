/**
 * Cached peg stats loader — avoids querying stablecoin_peg_stats on every
 * /yields request. Cache TTL is 5 minutes; stats update every 15 minutes.
 */
import { db } from "../db/connection.js";
import { stablecoinPegStats } from "../db/schema.js";
import { numOrNull, cachedAsync } from "../../shared/utils.js";
import type { PegStabilityData } from "../../shared/types.js";

export async function getPegStatsMap(): Promise<Map<string, PegStabilityData>> {
  return cachedAsync("peg-stats-map", 5 * 60_000, async () => {
    const rows = await db.select().from(stablecoinPegStats);
    const map = new Map<string, PegStabilityData>();
    for (const row of rows) {
      map.set(row.symbol, {
        symbol: row.symbol,
        price_current: numOrNull(row.price_current),
        peg_type: row.peg_type,
        peg_target: numOrNull(row.peg_target),
        min_price_1d: numOrNull(row.min_price_1d),
        max_price_1d: numOrNull(row.max_price_1d),
        snapshot_count_1d: row.snapshot_count_1d ?? 0,
        peg_adherence_7d: numOrNull(row.peg_adherence_7d),
        max_deviation_7d: numOrNull(row.max_deviation_7d),
        peg_adherence_30d: numOrNull(row.peg_adherence_30d),
        max_deviation_30d: numOrNull(row.max_deviation_30d),
        volatility_7d: numOrNull(row.volatility_7d),
        volatility_30d: numOrNull(row.volatility_30d),
        min_price_7d: numOrNull(row.min_price_7d),
        max_price_7d: numOrNull(row.max_price_7d),
        min_price_30d: numOrNull(row.min_price_30d),
        max_price_30d: numOrNull(row.max_price_30d),
        snapshot_count_7d: row.snapshot_count_7d ?? 0,
        snapshot_count_30d: row.snapshot_count_30d ?? 0,
        liquidity_usd: numOrNull(row.liquidity_usd),
      });
    }
    return map;
  });
}
