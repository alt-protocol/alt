/**
 * Shared utilities for yield fetchers.
 * Port of backend/app/services/utils.py + kamino_fetcher.py shared helpers.
 */
import { eq, and, sql, avg, gte, lte, isNotNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  yieldOpportunities,
  yieldSnapshots,
  protocols,
} from "../db/schema.js";
import { logger } from "../../shared/logger.js";
import { safeFloat } from "../../shared/utils.js";
import {
  REGULAR_STABLES,
  YIELD_BEARING_STABLES,
  LST_SYMBOLS,
} from "../../shared/constants.js";

// Re-export for convenience
export { safeFloat, REGULAR_STABLES, YIELD_BEARING_STABLES, LST_SYMBOLS };

export function classifyToken(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (YIELD_BEARING_STABLES.has(symbol)) return "yield_bearing_stable";
  for (const s of REGULAR_STABLES) {
    if (s.toUpperCase() === upper) return "stable";
  }
  if (LST_SYMBOLS.has(upper)) return "lst";
  return "volatile";
}

export function classifyMultiplyPair(
  collSymbol: string,
  debtSymbol: string,
): string {
  const collType = classifyToken(collSymbol);
  const debtType = classifyToken(debtSymbol);

  if (
    collType === "yield_bearing_stable" &&
    (debtType === "stable" || debtType === "yield_bearing_stable")
  )
    return "rwa_loop";
  if (collType === "stable" && debtType === "stable") return "stable_loop";
  if (collType === "lst" && (debtType === "lst" || debtType === "volatile"))
    return "sol_loop";
  return "directional_leverage";
}

// ---------------------------------------------------------------------------
// Upsert opportunity + snapshot
// ---------------------------------------------------------------------------

export interface UpsertParams {
  protocolId: number;
  protocolName: string;
  externalId: string;
  name: string;
  category: string;
  tokens: string[];
  apyCurrent: number | null;
  tvlUsd: number | null;
  depositAddress: string | null;
  riskTier: string;
  extra: Record<string, unknown>;
  now: Date;
  source: string;
  apy7dAvg?: number | null;
  apy30dAvg?: number | null;
  minDeposit?: number | null;
  maxLeverage?: number | null;
  lockPeriodDays?: number | null;
  liquidityAvailableUsd?: number | null;
  isAutomated?: boolean | null;
  depeg?: number | null;
}

export async function upsertOpportunity(
  db: NodePgDatabase,
  p: UpsertParams,
): Promise<{ id: number }> {
  // Find existing by external_id
  const existing = await db
    .select({ id: yieldOpportunities.id })
    .from(yieldOpportunities)
    .where(eq(yieldOpportunities.external_id, p.externalId))
    .limit(1);

  let oppId: number;

  if (existing.length > 0) {
    oppId = existing[0].id;
    const updates: Record<string, unknown> = {
      name: p.name,
      apy_current: p.apyCurrent?.toString() ?? null,
      apy_7d_avg: p.apy7dAvg?.toString() ?? null,
      apy_30d_avg: p.apy30dAvg?.toString() ?? null,
      tvl_usd: p.tvlUsd?.toString() ?? null,
      tokens: p.tokens,
      deposit_address: p.depositAddress,
      protocol_name: p.protocolName,
      is_active: true,
      extra_data: p.extra,
      updated_at: p.now,
    };
    if (p.maxLeverage !== undefined)
      updates.max_leverage = p.maxLeverage?.toString() ?? null;
    if (p.liquidityAvailableUsd !== undefined)
      updates.liquidity_available_usd =
        p.liquidityAvailableUsd?.toString() ?? null;
    if (p.isAutomated !== undefined) updates.is_automated = p.isAutomated;
    if (p.depeg !== undefined) updates.depeg = p.depeg?.toString() ?? null;
    if (p.lockPeriodDays !== undefined)
      updates.lock_period_days = p.lockPeriodDays;

    await db
      .update(yieldOpportunities)
      .set(updates)
      .where(eq(yieldOpportunities.id, oppId));
  } else {
    const inserted = await db
      .insert(yieldOpportunities)
      .values({
        protocol_id: p.protocolId,
        external_id: p.externalId,
        name: p.name,
        category: p.category,
        tokens: p.tokens,
        apy_current: p.apyCurrent?.toString() ?? null,
        apy_7d_avg: p.apy7dAvg?.toString() ?? null,
        apy_30d_avg: p.apy30dAvg?.toString() ?? null,
        tvl_usd: p.tvlUsd?.toString() ?? null,
        deposit_address: p.depositAddress,
        protocol_name: p.protocolName,
        risk_tier: p.riskTier,
        is_active: true,
        extra_data: p.extra,
        min_deposit: p.minDeposit?.toString() ?? null,
        max_leverage: p.maxLeverage?.toString() ?? null,
        lock_period_days: p.lockPeriodDays ?? 0,
        liquidity_available_usd:
          p.liquidityAvailableUsd?.toString() ?? null,
        is_automated: p.isAutomated ?? null,
        depeg: p.depeg?.toString() ?? null,
      })
      .returning({ id: yieldOpportunities.id });
    oppId = inserted[0].id;
  }

  // Record snapshot
  await db.insert(yieldSnapshots).values({
    opportunity_id: oppId,
    apy: p.apyCurrent?.toString() ?? null,
    tvl_usd: p.tvlUsd?.toString() ?? null,
    snapshot_at: p.now,
    source: p.source,
  });

  return { id: oppId };
}

// ---------------------------------------------------------------------------
// Batch snapshot averages (ported from kamino_fetcher.py _batch_snapshot_avg)
// ---------------------------------------------------------------------------

export async function batchSnapshotAvg(
  db: NodePgDatabase,
  protocolId: number,
  category: string,
  options?: { strict?: boolean },
): Promise<Record<string, { "7d": number | null; "30d": number | null }>> {
  const strict = options?.strict ?? true;
  const now = new Date();
  const result: Record<string, { "7d": number | null; "30d": number | null }> =
    {};

  for (const [days, key] of [
    [7, "7d"],
    [30, "30d"],
  ] as const) {
    const since = new Date(now.getTime() - days * 86_400_000);

    let rows;
    if (strict) {
      const halfWindow = new Date(now.getTime() - Math.floor(days / 2) * 86_400_000);

      rows = await db.execute(sql`
        SELECT yo.external_id, AVG(ys.apy) as avg_apy
        FROM discover.yield_snapshots ys
        JOIN discover.yield_opportunities yo ON yo.id = ys.opportunity_id
        WHERE yo.protocol_id = ${protocolId}
          AND yo.category = ${category}
          AND ys.snapshot_at >= ${since}
          AND ys.apy IS NOT NULL
          AND yo.id IN (
            SELECT DISTINCT ys2.opportunity_id
            FROM discover.yield_snapshots ys2
            JOIN discover.yield_opportunities yo2 ON yo2.id = ys2.opportunity_id
            WHERE yo2.protocol_id = ${protocolId}
              AND yo2.category = ${category}
              AND ys2.snapshot_at <= ${halfWindow}
          )
        GROUP BY yo.external_id
      `);
    } else {
      rows = await db.execute(sql`
        SELECT yo.external_id, AVG(ys.apy) as avg_apy
        FROM discover.yield_snapshots ys
        JOIN discover.yield_opportunities yo ON yo.id = ys.opportunity_id
        WHERE yo.protocol_id = ${protocolId}
          AND yo.category = ${category}
          AND ys.snapshot_at >= ${since}
          AND ys.apy IS NOT NULL
        GROUP BY yo.external_id
      `);
    }

    for (const row of rows.rows) {
      const extId = row.external_id as string;
      if (!result[extId]) result[extId] = { "7d": null, "30d": null };
      result[extId][key] =
        row.avg_apy !== null ? Number(row.avg_apy) : null;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Single-opportunity snapshot average (ported from drift_fetcher.py)
// ---------------------------------------------------------------------------

export async function snapshotAvg(
  db: NodePgDatabase,
  oppId: number,
  days: number,
): Promise<number | null> {
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const halfWindow = new Date(now.getTime() - Math.floor(days / 2) * 86_400_000);

  // Check if at least one snapshot is old enough
  const hasOldEnough = await db
    .select({ id: yieldSnapshots.id })
    .from(yieldSnapshots)
    .where(
      and(
        eq(yieldSnapshots.opportunity_id, oppId),
        lte(yieldSnapshots.snapshot_at, halfWindow),
      ),
    )
    .limit(1);

  if (hasOldEnough.length === 0) return null;

  const rows = await db
    .select({ apy: yieldSnapshots.apy })
    .from(yieldSnapshots)
    .where(
      and(
        eq(yieldSnapshots.opportunity_id, oppId),
        gte(yieldSnapshots.snapshot_at, since),
        isNotNull(yieldSnapshots.apy),
      ),
    );

  if (rows.length < 2) return null;

  const sum = rows.reduce((acc, r) => acc + Number(r.apy), 0);
  return sum / rows.length;
}

// ---------------------------------------------------------------------------
// Deactivate stale entries
// ---------------------------------------------------------------------------

export async function deactivateStale(
  db: NodePgDatabase,
  pattern: string,
  activeIds: Set<string>,
): Promise<number> {
  const stale = await db
    .select({
      id: yieldOpportunities.id,
      external_id: yieldOpportunities.external_id,
    })
    .from(yieldOpportunities)
    .where(
      and(
        sql`${yieldOpportunities.external_id} LIKE ${pattern}`,
        eq(yieldOpportunities.is_active, true),
      ),
    );

  let deactivated = 0;
  for (const row of stale) {
    if (row.external_id && !activeIds.has(row.external_id)) {
      await db
        .update(yieldOpportunities)
        .set({ is_active: false })
        .where(eq(yieldOpportunities.id, row.id));
      deactivated++;
    }
  }
  if (deactivated > 0) {
    logger.info({ pattern, deactivated }, "Deactivated stale entries");
  }
  return deactivated;
}

// ---------------------------------------------------------------------------
// Protocol lookup
// ---------------------------------------------------------------------------

export async function getProtocol(
  db: NodePgDatabase,
  slug: string,
): Promise<{ id: number; name: string } | null> {
  const rows = await db
    .select({ id: protocols.id, name: protocols.name })
    .from(protocols)
    .where(eq(protocols.slug, slug))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}
