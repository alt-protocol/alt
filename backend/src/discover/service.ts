/**
 * DiscoverService — public interface for cross-module reads.
 *
 * Consumed by Monitor and Manage modules in later phases.
 */
import {
  eq,
  and,
  or,
  asc,
  gte,
  sql,
  arrayOverlaps,
} from "drizzle-orm";
import { db } from "./db/connection.js";
import { yieldOpportunities, yieldSnapshots, protocols } from "./db/schema.js";
import type {
  DiscoverService,
  OpportunityDetail,
  OpportunityMapEntry,
  PegStabilityData,
  SearchYieldsParams,
  SearchYieldsResult,
  ShieldWarning,
  UnderlyingToken,
} from "../shared/types.js";
import { numOrNull } from "../shared/utils.js";
import { STABLECOIN_SYMBOLS } from "../shared/constants.js";
import { getPegStatsMap } from "./services/peg-stats-cache.js";
import { getShieldWarningsMap } from "./services/shield-warnings-cache.js";

export const discoverService: DiscoverService = {
  async getOpportunityById(id: number): Promise<OpportunityDetail | null> {
    const rows = await db
      .select({
        opp: yieldOpportunities,
        protocol: protocols,
      })
      .from(yieldOpportunities)
      .leftJoin(protocols, eq(yieldOpportunities.protocol_id, protocols.id))
      .where(eq(yieldOpportunities.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    const { opp, protocol } = rows[0];

    return {
      id: opp.id,
      protocol_id: opp.protocol_id,
      external_id: opp.external_id,
      name: opp.name,
      category: opp.category,
      tokens: opp.tokens,
      apy_current: numOrNull(opp.apy_current),
      tvl_usd: numOrNull(opp.tvl_usd),
      deposit_address: opp.deposit_address,
      extra_data: opp.extra_data as Record<string, unknown> | null,
      protocol: protocol
        ? { id: protocol.id, slug: protocol.slug, name: protocol.name }
        : null,
    };
  },

  async searchYields(params: SearchYieldsParams): Promise<SearchYieldsResult> {
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const sort = params.sort ?? "apy_desc";

    const conditions: ReturnType<typeof eq>[] = [
      eq(yieldOpportunities.is_active, true),
    ];

    if (params.category) {
      conditions.push(eq(yieldOpportunities.category, params.category));
    }

    if (params.vault_tag) {
      conditions.push(
        sql`${yieldOpportunities.extra_data}->>'vault_tag' = ${params.vault_tag}`,
      );
    }

    if (params.tokens) {
      const tokenList = params.tokens.split(",").map((t) => t.trim());
      conditions.push(arrayOverlaps(yieldOpportunities.tokens, tokenList));
    }

    // Hide opportunities with negligible available liquidity
    conditions.push(
      or(
        sql`${yieldOpportunities.liquidity_available_usd} IS NULL`,
        sql`${yieldOpportunities.liquidity_available_usd} >= 100`,
      )!,
    );

    if (params.stablecoins_only) {
      conditions.push(sql`${yieldOpportunities.apy_current} > 0`);
      const stableArr = [...STABLECOIN_SYMBOLS];
      conditions.push(
        or(
          and(
            eq(yieldOpportunities.category, "multiply"),
            sql`${yieldOpportunities.extra_data}->>'vault_tag' IN ('stable_loop', 'rwa_loop')`,
          ),
          and(
            sql`${yieldOpportunities.category} != 'multiply'`,
            arrayOverlaps(yieldOpportunities.tokens, stableArr),
          ),
          sql`EXISTS (SELECT 1 FROM unnest(${yieldOpportunities.tokens}) AS t WHERE t LIKE 'PT-%')`,
        )!,
      );
    }

    let orderBy;
    switch (sort) {
      case "apy_asc":
        orderBy = sql`${yieldOpportunities.apy_current} ASC NULLS FIRST`;
        break;
      case "tvl_desc":
        orderBy = sql`${yieldOpportunities.tvl_usd} DESC NULLS LAST`;
        break;
      case "tvl_asc":
        orderBy = sql`${yieldOpportunities.tvl_usd} ASC NULLS FIRST`;
        break;
      default:
        orderBy = sql`${yieldOpportunities.apy_current} DESC NULLS LAST`;
    }

    const [pegMap, shieldMap] = await Promise.all([
      getPegStatsMap(),
      getShieldWarningsMap(),
    ]);

    const rows = await db
      .select({
        opp: yieldOpportunities,
        _total: sql<number>`count(*) over()`.as("_total"),
      })
      .from(yieldOpportunities)
      .where(and(...conditions))
      .orderBy(orderBy)
      .offset(offset)
      .limit(limit);

    const total = rows.length > 0 ? Number(rows[0]._total) : 0;

    let lastUpdated: Date | null = null;
    const data = rows.map((r) => {
      const o = r.opp;
      if (o.updated_at && (!lastUpdated || o.updated_at > lastUpdated)) {
        lastUpdated = o.updated_at;
      }
      const extra = o.extra_data as Record<string, unknown> | null;

      // Find primary stablecoin for peg_stability lookup
      let pegStability: PegStabilityData | null = null;
      if (o.category === "multiply") {
        const collateral = extra?.collateral_symbol as string | undefined;
        if (collateral) pegStability = pegMap.get(collateral) ?? null;
      }
      if (!pegStability) {
        for (const t of o.tokens) {
          if (STABLECOIN_SYMBOLS.has(t) && pegMap.has(t)) {
            pegStability = pegMap.get(t)!;
            break;
          }
        }
      }

      return {
        id: o.id,
        protocol_id: o.protocol_id,
        external_id: o.external_id,
        name: o.name,
        category: o.category,
        tokens: o.tokens,
        apy_current: numOrNull(o.apy_current),
        apy_7d_avg: numOrNull(o.apy_7d_avg),
        apy_30d_avg: numOrNull(o.apy_30d_avg),
        tvl_usd: numOrNull(o.tvl_usd),
        min_deposit: numOrNull(o.min_deposit),
        lock_period_days: o.lock_period_days ?? 0,
        risk_tier: o.risk_tier,
        protocol_name: o.protocol_name,
        is_active: o.is_active,
        max_leverage: numOrNull(o.max_leverage),
        utilization_pct: numOrNull(o.utilization_pct),
        liquidity_available_usd: numOrNull(o.liquidity_available_usd),
        is_automated: o.is_automated,
        depeg: numOrNull(o.depeg),
        underlying_tokens: o.underlying_tokens ?? null,
        protocol_url: (extra?.protocol_url as string) ?? null,
        updated_at: o.updated_at,
        peg_stability: pegStability,
        token_warnings: (() => {
          const ut = o.underlying_tokens as UnderlyingToken[] | null;
          if (!ut) return null;
          const seen = new Set<string>();
          const warnings: ShieldWarning[] = [];
          for (const t of ut) {
            if (t.mint && shieldMap.has(t.mint)) {
              for (const w of shieldMap.get(t.mint)!) {
                if (!seen.has(w.type)) {
                  seen.add(w.type);
                  warnings.push(w);
                }
              }
            }
          }
          return warnings.length > 0 ? warnings : null;
        })(),
      };
    });

    return {
      data,
      meta: { total, last_updated: lastUpdated, limit, offset },
    };
  },

  async getYieldHistory(opportunityId: number, period: "7d" | "30d" | "90d" = "7d") {
    const exists = await db
      .select({ id: yieldOpportunities.id })
      .from(yieldOpportunities)
      .where(eq(yieldOpportunities.id, opportunityId))
      .limit(1);

    if (exists.length === 0) return null;

    const days = { "7d": 7, "30d": 30, "90d": 90 }[period] ?? 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const snapshots = await db
      .select()
      .from(yieldSnapshots)
      .where(
        and(
          eq(yieldSnapshots.opportunity_id, opportunityId),
          gte(yieldSnapshots.snapshot_at, since),
        ),
      )
      .orderBy(asc(yieldSnapshots.snapshot_at))
      .limit(500);

    return {
      data: snapshots.map((s) => ({
        snapshot_at: s.snapshot_at,
        apy: numOrNull(s.apy),
        tvl_usd: numOrNull(s.tvl_usd),
      })),
      meta: { total: snapshots.length, period },
    };
  },

  async getProtocols() {
    const rows = await db
      .select()
      .from(protocols)
      .orderBy(asc(protocols.name));

    return {
      data: rows.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        website_url: p.website_url,
        logo_url: p.logo_url,
        audit_status: p.audit_status,
        auditors: p.auditors,
        integration: p.integration,
      })),
    };
  },

  async getOpportunityMap(): Promise<Record<string, OpportunityMapEntry>> {
    const rows = await db
      .select({
        id: yieldOpportunities.id,
        deposit_address: yieldOpportunities.deposit_address,
        external_id: yieldOpportunities.external_id,
        apy_current: yieldOpportunities.apy_current,
        tvl_usd: yieldOpportunities.tvl_usd,
        tokens: yieldOpportunities.tokens,
      })
      .from(yieldOpportunities);

    const result: Record<string, OpportunityMapEntry> = {};
    for (const row of rows) {
      const entry: OpportunityMapEntry = {
        id: row.id,
        apy_current: numOrNull(row.apy_current),
        tvl_usd: numOrNull(row.tvl_usd),
        first_token: row.tokens.length > 0 ? row.tokens[0] : null,
      };
      if (row.deposit_address) result[row.deposit_address] = entry;
      if (row.external_id) result[row.external_id] = entry;
    }
    return result;
  },
};
