import type { FastifyInstance } from "fastify";
import {
  sql,
  eq,
  and,
  or,
  asc,
  gte,
  arrayOverlaps,
} from "drizzle-orm";
import { db } from "../db/connection.js";
import { yieldOpportunities, yieldSnapshots, protocols } from "../db/schema.js";
import { NotFoundError } from "../../shared/error-handler.js";
import { STABLECOIN_SYMBOLS } from "../../shared/constants.js";
import { YieldsQuery, YieldHistoryQuery } from "./schemas.js";

const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

function numOrNull(val: string | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export async function yieldsRoutes(app: FastifyInstance) {
  // -----------------------------------------------------------------------
  // GET /yields
  // -----------------------------------------------------------------------
  app.get("/yields", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (request) => {
      const q = YieldsQuery.parse(request.query);

      const conditions: ReturnType<typeof eq>[] = [
        eq(yieldOpportunities.is_active, true),
      ];

      if (q.category) {
        conditions.push(eq(yieldOpportunities.category, q.category));
      }

      if (q.vault_tag) {
        conditions.push(
          sql`${yieldOpportunities.extra_data}->>'vault_tag' = ${q.vault_tag}`,
        );
      }

      if (q.tokens) {
        const tokenList = q.tokens.split(",").map((t) => t.trim());
        conditions.push(arrayOverlaps(yieldOpportunities.tokens, tokenList));
      }

      if (q.stablecoins_only) {
        conditions.push(
          sql`${yieldOpportunities.apy_current} > 0`,
        );
        const stableArr = [...STABLECOIN_SYMBOLS];
        conditions.push(
          or(
            // Multiply: stable_loop or rwa_loop
            and(
              eq(yieldOpportunities.category, "multiply"),
              sql`${yieldOpportunities.extra_data}->>'vault_tag' IN ('stable_loop', 'rwa_loop')`,
            ),
            // Non-multiply: at least one stablecoin token
            and(
              sql`${yieldOpportunities.category} != 'multiply'`,
              arrayOverlaps(yieldOpportunities.tokens, stableArr),
            ),
            // PT-* tokens
            sql`EXISTS (SELECT 1 FROM unnest(${yieldOpportunities.tokens}) AS t WHERE t LIKE 'PT-%')`,
          )!,
        );
      }

      // Sort
      let orderBy;
      switch (q.sort) {
        case "apy_asc":
          orderBy = sql`${yieldOpportunities.apy_current} ASC NULLS FIRST`;
          break;
        case "tvl_desc":
          orderBy = sql`${yieldOpportunities.tvl_usd} DESC NULLS LAST`;
          break;
        case "tvl_asc":
          orderBy = sql`${yieldOpportunities.tvl_usd} ASC NULLS FIRST`;
          break;
        default: // apy_desc
          orderBy = sql`${yieldOpportunities.apy_current} DESC NULLS LAST`;
      }

      const rows = await db
        .select({
          opp: yieldOpportunities,
          _total: sql<number>`count(*) over()`.as("_total"),
        })
        .from(yieldOpportunities)
        .where(and(...conditions))
        .orderBy(orderBy)
        .offset(q.offset)
        .limit(q.limit);

      const total = rows.length > 0 ? Number(rows[0]._total) : 0;

      let lastUpdated: Date | null = null;
      const data = rows.map((r) => {
        const o = r.opp;
        if (o.updated_at && (!lastUpdated || o.updated_at > lastUpdated)) {
          lastUpdated = o.updated_at;
        }
        const extra = o.extra_data as Record<string, unknown> | null;
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
          protocol_url: extra?.protocol_url ?? null,
          updated_at: o.updated_at,
        };
      });

      return {
        data,
        meta: {
          total,
          last_updated: lastUpdated,
          limit: q.limit,
          offset: q.offset,
        },
      };
    },
  });

  // -----------------------------------------------------------------------
  // GET /yields/:id
  // -----------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/yields/:id", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (request) => {
      const yieldId = Number(request.params.id);

      const oppRows = await db
        .select({
          opp: yieldOpportunities,
          protocol: protocols,
        })
        .from(yieldOpportunities)
        .leftJoin(protocols, eq(yieldOpportunities.protocol_id, protocols.id))
        .where(eq(yieldOpportunities.id, yieldId))
        .limit(1);

      if (oppRows.length === 0) {
        throw new NotFoundError("Yield opportunity not found");
      }

      const { opp, protocol } = oppRows[0];

      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const snapshots = await db
        .select()
        .from(yieldSnapshots)
        .where(
          and(
            eq(yieldSnapshots.opportunity_id, yieldId),
            gte(yieldSnapshots.snapshot_at, since),
          ),
        )
        .orderBy(asc(yieldSnapshots.snapshot_at));

      const extra = opp.extra_data as Record<string, unknown> | null;

      return {
        id: opp.id,
        protocol_id: opp.protocol_id,
        external_id: opp.external_id,
        name: opp.name,
        category: opp.category,
        tokens: opp.tokens,
        apy_current: numOrNull(opp.apy_current),
        apy_7d_avg: numOrNull(opp.apy_7d_avg),
        apy_30d_avg: numOrNull(opp.apy_30d_avg),
        tvl_usd: numOrNull(opp.tvl_usd),
        min_deposit: numOrNull(opp.min_deposit),
        lock_period_days: opp.lock_period_days ?? 0,
        risk_tier: opp.risk_tier,
        protocol_name: opp.protocol_name,
        is_active: opp.is_active,
        max_leverage: numOrNull(opp.max_leverage),
        utilization_pct: numOrNull(opp.utilization_pct),
        liquidity_available_usd: numOrNull(opp.liquidity_available_usd),
        is_automated: opp.is_automated,
        depeg: numOrNull(opp.depeg),
        protocol_url: extra?.protocol_url ?? null,
        updated_at: opp.updated_at,
        extra_data: opp.extra_data,
        deposit_address: opp.deposit_address,
        protocol: protocol
          ? {
              id: protocol.id,
              slug: protocol.slug,
              name: protocol.name,
              description: protocol.description,
              website_url: protocol.website_url,
              logo_url: protocol.logo_url,
              audit_status: protocol.audit_status,
              auditors: protocol.auditors,
              integration: protocol.integration,
            }
          : null,
        recent_snapshots: snapshots.map((s) => ({
          snapshot_at: s.snapshot_at,
          apy: numOrNull(s.apy),
          tvl_usd: numOrNull(s.tvl_usd),
        })),
      };
    },
  });

  // -----------------------------------------------------------------------
  // GET /yields/:id/history
  // -----------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/yields/:id/history", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (request) => {
      const yieldId = Number(request.params.id);
      const q = YieldHistoryQuery.parse(request.query);

      // Verify opportunity exists
      const exists = await db
        .select({ id: yieldOpportunities.id })
        .from(yieldOpportunities)
        .where(eq(yieldOpportunities.id, yieldId))
        .limit(1);

      if (exists.length === 0) {
        throw new NotFoundError("Yield opportunity not found");
      }

      const days = PERIOD_DAYS[q.period] ?? 7;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const whereClause = and(
        eq(yieldSnapshots.opportunity_id, yieldId),
        gte(yieldSnapshots.snapshot_at, since),
      );

      const [countResult, snapshots] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(yieldSnapshots)
          .where(whereClause),
        db
          .select()
          .from(yieldSnapshots)
          .where(whereClause)
          .orderBy(asc(yieldSnapshots.snapshot_at))
          .offset(q.offset)
          .limit(q.limit),
      ]);

      return {
        data: snapshots.map((s) => ({
          snapshot_at: s.snapshot_at,
          apy: numOrNull(s.apy),
          tvl_usd: numOrNull(s.tvl_usd),
        })),
        meta: {
          total: Number(countResult[0].count),
          limit: q.limit,
          offset: q.offset,
        },
      };
    },
  });
}
