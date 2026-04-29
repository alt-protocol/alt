/**
 * Stablecoin price & liquidity fetcher.
 *
 * Every 15 minutes:
 *   1) Jupiter Price API v3 — current prices + DEX liquidity for all tracked
 *      stablecoins in a single batched call (up to 50 mints).
 *   2) Store price snapshots in stablecoin_price_snapshots.
 *   3) Recompute rolling peg stats (7d/30d) in stablecoin_peg_stats.
 */
import { sql } from "drizzle-orm";
import { getWithRetry, jupiterHeaders } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { STABLECOIN_PEG_CONFIG } from "../../shared/constants.js";
import type { StablecoinPegEntry } from "../../shared/constants.js";
import { db } from "../db/connection.js";
import { stablecoinPriceSnapshots, stablecoinPegStats } from "../db/schema.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JUPITER_PRICE_API = "https://api.jup.ag/price/v3";

/** Minimum snapshots to compute volatility/adherence */
const MIN_SNAPSHOTS_FOR_STATS = 2;

// ---------------------------------------------------------------------------
// Phase A — Price poll
// ---------------------------------------------------------------------------

interface PriceData {
  prices: Map<string, number>;
  liquidity: Map<string, number>;
}

async function fetchPrices(
  headers: Record<string, string>,
): Promise<PriceData> {
  const mints = STABLECOIN_PEG_CONFIG.map((c) => c.mint).join(",");
  const url = `${JUPITER_PRICE_API}?ids=${mints}`;

  const raw = (await getWithRetry(url, { headers })) as Record<
    string,
    { usdPrice?: number | string; liquidity?: number } | undefined
  >;
  const prices = new Map<string, number>();
  const liquidity = new Map<string, number>();

  if (!raw || typeof raw !== "object") {
    logger.warn("Jupiter Price API: unexpected response format");
    return { prices, liquidity };
  }

  for (const cfg of STABLECOIN_PEG_CONFIG) {
    const entry = raw[cfg.mint];
    if (!entry?.usdPrice) continue;
    const p = Number(entry.usdPrice);
    if (Number.isFinite(p) && p > 0) {
      prices.set(cfg.mint, p);
    }
    const liq = Number(entry.liquidity ?? 0);
    if (Number.isFinite(liq) && liq > 0) {
      liquidity.set(cfg.mint, liq);
    }
  }

  return { prices, liquidity };
}

async function insertSnapshots(
  prices: Map<string, number>,
  now: Date,
): Promise<void> {
  if (prices.size === 0) return;

  // Guard against duplicate snapshots on rapid dev restarts
  const recentCheck = await db.execute(sql`
    SELECT 1 FROM ${stablecoinPriceSnapshots}
    WHERE snapshot_at >= NOW() - INTERVAL '10 minutes'
    LIMIT 1
  `);
  const hasRecent = ((recentCheck as unknown as { rows: unknown[] }).rows ?? []).length > 0;
  if (hasRecent) {
    logger.info("Skipping snapshot insert — recent data exists (< 10 min)");
    return;
  }

  const rows = STABLECOIN_PEG_CONFIG
    .filter((c) => prices.has(c.mint))
    .map((c) => ({
      mint: c.mint,
      symbol: c.symbol,
      price_usd: String(prices.get(c.mint)!),
      snapshot_at: now,
    }));

  await db.insert(stablecoinPriceSnapshots).values(rows);
}

// ---------------------------------------------------------------------------
// Phase C — Stats recomputation
// ---------------------------------------------------------------------------

interface WindowStats {
  cnt: number;
  min_p: string | null;
  max_p: string | null;
  max_dev: string | null;
  adherence: string | null;
  volatility: string | null;
}

async function computeWindowStats(
  cfg: StablecoinPegEntry,
  days: number,
): Promise<WindowStats> {
  const interval = `${days} days`;
  const result = await db.execute(sql`
    WITH ordered AS (
      SELECT
        price_usd::float8 AS p,
        LAG(price_usd::float8) OVER (ORDER BY snapshot_at) AS prev_p
      FROM ${stablecoinPriceSnapshots}
      WHERE mint = ${cfg.mint}
        AND snapshot_at >= NOW() - ${sql.raw(`INTERVAL '${interval}'`)}
      ORDER BY snapshot_at
    ),
    returns AS (
      SELECT
        p,
        CASE WHEN prev_p > 0 THEN (p - prev_p) / prev_p ELSE NULL END AS ret
      FROM ordered
    )
    SELECT
      COUNT(*)::int AS cnt,
      MIN(p)::text AS min_p,
      MAX(p)::text AS max_p,
      ${cfg.pegTarget !== null
        ? sql`MAX(ABS(p - ${cfg.pegTarget}) / ${cfg.pegTarget} * 100)::text`
        : sql`NULL::text`
      } AS max_dev,
      ${cfg.pegTarget !== null
        ? sql`(COUNT(*) FILTER (WHERE ABS(p - ${cfg.pegTarget}) / ${cfg.pegTarget} * 100 <= 0.1) * 100.0 / NULLIF(COUNT(*), 0))::text`
        : sql`NULL::text`
      } AS adherence,
      CASE WHEN COUNT(ret) >= 2 THEN (STDDEV_POP(ret) * 100)::text ELSE NULL END AS volatility
    FROM returns
  `);

  const row = (result as unknown as { rows: Record<string, unknown>[] }).rows[0];
  if (!row) {
    return { cnt: 0, min_p: null, max_p: null, max_dev: null, adherence: null, volatility: null };
  }
  return {
    cnt: Number(row.cnt) || 0,
    min_p: row.min_p as string | null,
    max_p: row.max_p as string | null,
    max_dev: row.max_dev as string | null,
    adherence: row.adherence as string | null,
    volatility: row.volatility as string | null,
  };
}

async function recomputeStats(
  prices: Map<string, number>,
  liquidity: Map<string, number>,
): Promise<void> {
  for (const cfg of STABLECOIN_PEG_CONFIG) {
    const currentPrice = prices.get(cfg.mint);
    const liq = liquidity.get(cfg.mint);

    const s1 = await computeWindowStats(cfg, 1);
    const s7 = await computeWindowStats(cfg, 7);
    const s30 = await computeWindowStats(cfg, 30);

    const cnt1 = s1.cnt;
    const cnt7 = s7.cnt;
    const cnt30 = s30.cnt;

    const values = {
      mint: cfg.mint,
      symbol: cfg.symbol,
      price_current: currentPrice != null ? String(currentPrice) : null,
      peg_type: cfg.pegType,
      peg_target: cfg.pegTarget != null ? String(cfg.pegTarget) : null,
      // 1d
      snapshot_count_1d: cnt1,
      min_price_1d: s1.min_p,
      max_price_1d: s1.max_p,
      max_deviation_1d: cnt1 >= MIN_SNAPSHOTS_FOR_STATS ? s1.max_dev : null,
      peg_adherence_1d: cnt1 >= MIN_SNAPSHOTS_FOR_STATS ? s1.adherence : null,
      volatility_1d: cnt1 >= MIN_SNAPSHOTS_FOR_STATS ? s1.volatility : null,
      // 7d
      snapshot_count_7d: cnt7,
      min_price_7d: s7.min_p,
      max_price_7d: s7.max_p,
      max_deviation_7d: cnt7 >= MIN_SNAPSHOTS_FOR_STATS ? s7.max_dev : null,
      peg_adherence_7d: cnt7 >= MIN_SNAPSHOTS_FOR_STATS ? s7.adherence : null,
      volatility_7d: cnt7 >= MIN_SNAPSHOTS_FOR_STATS ? s7.volatility : null,
      // 30d
      snapshot_count_30d: cnt30,
      min_price_30d: s30.min_p,
      max_price_30d: s30.max_p,
      max_deviation_30d: cnt30 >= MIN_SNAPSHOTS_FOR_STATS ? s30.max_dev : null,
      peg_adherence_30d: cnt30 >= MIN_SNAPSHOTS_FOR_STATS ? s30.adherence : null,
      volatility_30d: cnt30 >= MIN_SNAPSHOTS_FOR_STATS ? s30.volatility : null,
      // DEX liquidity (from Jupiter Price API response)
      liquidity_usd: liq != null ? String(Math.round(liq)) : null,
      updated_at: new Date(),
    };

    await db
      .insert(stablecoinPegStats)
      .values(values)
      .onConflictDoUpdate({
        target: stablecoinPegStats.mint,
        set: {
          ...values,
          mint: undefined as never,
        },
      });
  }
}

// ---------------------------------------------------------------------------
// Main entry point (called by scheduler)
// ---------------------------------------------------------------------------

export async function fetchStablecoinPrices(): Promise<number> {
  const headers = jupiterHeaders();
  const now = new Date();

  // Fetch prices + liquidity from Jupiter Price API (single batched call)
  const { prices, liquidity } = await fetchPrices(headers);
  logger.info(
    { prices: prices.size, liquidity: liquidity.size },
    "Stablecoin prices fetched from Jupiter",
  );

  if (prices.size === 0) {
    logger.warn("No stablecoin prices retrieved — skipping snapshot + stats");
    return 0;
  }

  await insertSnapshots(prices, now);

  // Recompute rolling stats + store liquidity
  await recomputeStats(prices, liquidity);
  logger.info("Stablecoin peg stats recomputed");

  return prices.size;
}
