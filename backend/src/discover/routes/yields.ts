import type { FastifyInstance } from "fastify";
import {
  sql,
  eq,
  and,
  asc,
  gte,
} from "drizzle-orm";
import { db } from "../db/connection.js";
import { yieldOpportunities, yieldSnapshots, protocols } from "../db/schema.js";
import { NotFoundError } from "../../shared/error-handler.js";
import { numOrNull } from "../../shared/utils.js";
import { STABLECOIN_SYMBOLS } from "../../shared/constants.js";
import type { PegStabilityData } from "../../shared/types.js";
import { YieldsQuery, YieldHistoryQuery } from "./schemas.js";
import { discoverService } from "../service.js";
import { getPegStatsMap } from "../services/peg-stats-cache.js";

const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

export async function yieldsRoutes(app: FastifyInstance) {
  // -----------------------------------------------------------------------
  // GET /yields
  // -----------------------------------------------------------------------
  app.get("/yields", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (request) => {
      const q = YieldsQuery.parse(request.query);
      return discoverService.searchYields(q);
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

      const pegMap = await getPegStatsMap();
      let pegStability: PegStabilityData | null = null;
      if (opp.category === "multiply") {
        const collateral = extra?.collateral_symbol as string | undefined;
        if (collateral) pegStability = pegMap.get(collateral) ?? null;
      }
      if (!pegStability && opp.tokens) {
        for (const t of opp.tokens) {
          if (STABLECOIN_SYMBOLS.has(t) && pegMap.has(t)) {
            pegStability = pegMap.get(t)!;
            break;
          }
        }
      }

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
        underlying_tokens: opp.underlying_tokens ?? null,
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
        peg_stability: pegStability,
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
