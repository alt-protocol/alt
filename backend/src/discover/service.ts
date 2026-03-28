/**
 * DiscoverService — public interface for cross-module reads.
 *
 * Consumed by Monitor and Manage modules in later phases.
 */
import { eq } from "drizzle-orm";
import { db } from "./db/connection.js";
import { yieldOpportunities, protocols } from "./db/schema.js";
import type {
  DiscoverService,
  OpportunityDetail,
  OpportunityMapEntry,
} from "../shared/types.js";
import { safeFloat } from "../shared/utils.js";

function numOrNull(val: string | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

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
