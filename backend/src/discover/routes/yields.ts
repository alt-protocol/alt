import type { FastifyInstance } from "fastify";
import { NotFoundError } from "../../shared/error-handler.js";
import { numOrNull } from "../../shared/utils.js";
import { YieldsQuery, YieldHistoryQuery } from "./schemas.js";
import { discoverService } from "../service.js";

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
      const result = await discoverService.getOpportunityDetail(yieldId);

      if (!result) {
        throw new NotFoundError("Yield opportunity not found");
      }

      const { opp, protocol, snapshots, extra, pegStability } = result;

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
        recent_snapshots: snapshots,
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

      const result = await discoverService.getYieldHistoryPaginated(
        yieldId,
        q.period,
        q.limit,
        q.offset,
      );

      if (!result) {
        throw new NotFoundError("Yield opportunity not found");
      }

      return result;
    },
  });
}
