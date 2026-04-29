import { db } from "../../db/connection.js";
import { stablecoinPegStats } from "../../../discover/db/schema.js";
import type { AlertCondition } from "./types.js";

/**
 * Detect stablecoin depeg events by checking price deviation from peg target.
 * Returns one condition per stablecoin that deviates beyond minimum threshold.
 * detectedValue is deviation in basis points — user thresholds decide if it's alert-worthy.
 */
export async function detectDepegEvents(): Promise<AlertCondition[]> {
  const stats = await db
    .select({
      symbol: stablecoinPegStats.symbol,
      price_current: stablecoinPegStats.price_current,
      peg_target: stablecoinPegStats.peg_target,
      peg_type: stablecoinPegStats.peg_type,
    })
    .from(stablecoinPegStats);

  const conditions: AlertCondition[] = [];

  for (const s of stats) {
    const price = Number(s.price_current);
    const target = Number(s.peg_target);
    if (!price || !target) continue;

    // Only check fixed-peg stablecoins (not yield-bearing)
    if (s.peg_type !== "fixed") continue;

    // Skip non-USD stablecoins — e.g., EURC peg_target ≈ $1.08 (EUR/USD rate)
    // Forex fluctuations always look like depegs when measured in USD
    if (Math.abs(target - 1.0) > 0.02) continue;

    const deviationBps = Math.abs((price - target) / target) * 10000;

    // Only report if deviation is at least 10 bps (filter noise)
    if (deviationBps < 10) continue;

    conditions.push({
      ruleSlug: "depeg",
      entityKey: `token:${s.symbol}`,
      title: `Depeg: ${s.symbol}`,
      body: `${s.symbol} trading at $${price.toFixed(4)} (${deviationBps.toFixed(0)} bps off $${target.toFixed(2)} peg)`,
      metadata: {
        symbol: s.symbol,
        price_current: price,
        peg_target: target,
        deviation_bps: deviationBps,
      },
      detectedValue: deviationBps,
    });
  }

  return conditions;
}
