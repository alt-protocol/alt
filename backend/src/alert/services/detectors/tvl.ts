import { eq, and, gte, desc } from "drizzle-orm";
import { db } from "../../db/connection.js";
import { yieldOpportunities } from "../../../discover/db/schema.js";
import { yieldSnapshots } from "../../../discover/db/schema.js";
import type { AlertCondition } from "./types.js";

/**
 * Detect TVL drops by comparing current TVL against 24h-ago snapshot.
 * detectedValue is drop percentage — user thresholds decide if it's alert-worthy.
 */
export async function detectTvlDrops(): Promise<AlertCondition[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const opps = await db
    .select({
      id: yieldOpportunities.id,
      name: yieldOpportunities.name,
      tvl_current: yieldOpportunities.tvl_usd,
      protocol_name: yieldOpportunities.protocol_name,
    })
    .from(yieldOpportunities)
    .where(eq(yieldOpportunities.is_active, true));

  const conditions: AlertCondition[] = [];

  for (const opp of opps) {
    const currentTvl = Number(opp.tvl_current);
    if (!currentTvl || currentTvl === 0) continue;

    // Get the earliest snapshot from ~24h ago for this opportunity
    const [oldSnapshot] = await db
      .select({ tvl_usd: yieldSnapshots.tvl_usd })
      .from(yieldSnapshots)
      .where(
        and(
          eq(yieldSnapshots.opportunity_id, opp.id),
          gte(yieldSnapshots.snapshot_at, cutoff),
        ),
      )
      .orderBy(yieldSnapshots.snapshot_at)
      .limit(1);

    if (!oldSnapshot) continue;

    const oldTvl = Number(oldSnapshot.tvl_usd);
    if (!oldTvl || oldTvl === 0) continue;

    const dropPct = ((oldTvl - currentTvl) / oldTvl) * 100;
    if (dropPct <= 0) continue; // TVL increased, not a drop

    conditions.push({
      ruleSlug: "tvl_drop",
      entityKey: `opp:${opp.id}`,
      title: `TVL Drop: ${opp.name}`,
      body: `${opp.name} TVL dropped ${dropPct.toFixed(0)}% in 24h ($${(oldTvl / 1e6).toFixed(1)}M → $${(currentTvl / 1e6).toFixed(1)}M)`,
      metadata: {
        opportunity_id: opp.id,
        opportunity_name: opp.name,
        protocol: opp.protocol_name,
        tvl_current: currentTvl,
        tvl_24h_ago: oldTvl,
        drop_pct: dropPct,
      },
      detectedValue: dropPct,
    });
  }

  return conditions;
}
