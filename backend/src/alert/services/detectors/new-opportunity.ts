import { eq, and, gte } from "drizzle-orm";
import { db } from "../../db/connection.js";
import { yieldOpportunities } from "../../../discover/db/schema.js";
import type { AlertCondition } from "./types.js";

/**
 * Detect new yield opportunities created in the last 24h with APY above threshold.
 * detectedValue is the APY — user threshold (min_new_opp_apy) decides if it's worth notifying.
 */
export async function detectNewOpportunities(): Promise<AlertCondition[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const opps = await db
    .select({
      id: yieldOpportunities.id,
      name: yieldOpportunities.name,
      apy_current: yieldOpportunities.apy_current,
      tvl_usd: yieldOpportunities.tvl_usd,
      protocol_name: yieldOpportunities.protocol_name,
      category: yieldOpportunities.category,
      tokens: yieldOpportunities.tokens,
      created_at: yieldOpportunities.created_at,
    })
    .from(yieldOpportunities)
    .where(
      and(
        eq(yieldOpportunities.is_active, true),
        gte(yieldOpportunities.created_at, cutoff),
      ),
    );

  const conditions: AlertCondition[] = [];

  for (const opp of opps) {
    const apy = Number(opp.apy_current);
    if (!apy) continue;

    conditions.push({
      ruleSlug: "new_opportunity",
      entityKey: `opp:${opp.id}`,
      title: `New: ${opp.name}`,
      body: `${opp.name} on ${opp.protocol_name} — ${apy.toFixed(1)}% APY, $${(Number(opp.tvl_usd) / 1e6).toFixed(1)}M TVL`,
      metadata: {
        opportunity_id: opp.id,
        opportunity_name: opp.name,
        protocol: opp.protocol_name,
        category: opp.category,
        tokens: opp.tokens,
        apy: apy,
        tvl_usd: Number(opp.tvl_usd),
      },
      detectedValue: apy,
    });
  }

  return conditions;
}
