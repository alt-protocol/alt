import { eq } from "drizzle-orm";
import { db } from "../../db/connection.js";
import { yieldOpportunities } from "../../../discover/db/schema.js";
import type { AlertCondition } from "./types.js";

/**
 * Detect APY drops and spikes by comparing apy_current vs apy_30d_avg.
 * Returns one condition per opportunity that changed significantly.
 * The detectedValue is the absolute % change — user thresholds decide if it's alert-worthy.
 */
export async function detectApyChanges(): Promise<AlertCondition[]> {
  const opps = await db
    .select({
      id: yieldOpportunities.id,
      name: yieldOpportunities.name,
      apy_current: yieldOpportunities.apy_current,
      apy_30d_avg: yieldOpportunities.apy_30d_avg,
      protocol_name: yieldOpportunities.protocol_name,
    })
    .from(yieldOpportunities)
    .where(eq(yieldOpportunities.is_active, true));

  const conditions: AlertCondition[] = [];

  for (const opp of opps) {
    const current = Number(opp.apy_current);
    const avg = Number(opp.apy_30d_avg);
    if (!current || !avg || avg === 0) continue;

    const changePct = ((current - avg) / avg) * 100;

    if (changePct < 0) {
      conditions.push({
        ruleSlug: "apy_drop",
        entityKey: `opp:${opp.id}`,
        title: `APY Drop: ${opp.name}`,
        body: `${opp.name} APY dropped to ${current.toFixed(1)}% from 30d avg ${avg.toFixed(1)}% (${Math.abs(changePct).toFixed(0)}% decrease)`,
        metadata: {
          opportunity_id: opp.id,
          opportunity_name: opp.name,
          protocol: opp.protocol_name,
          apy_current: current,
          apy_30d_avg: avg,
          change_pct: changePct,
        },
        detectedValue: Math.abs(changePct),
      });
    }

    if (changePct > 0) {
      conditions.push({
        ruleSlug: "apy_spike",
        entityKey: `opp:${opp.id}`,
        title: `APY Spike: ${opp.name}`,
        body: `${opp.name} APY spiked to ${current.toFixed(1)}% from 30d avg ${avg.toFixed(1)}% (${changePct.toFixed(0)}% increase)`,
        metadata: {
          opportunity_id: opp.id,
          opportunity_name: opp.name,
          protocol: opp.protocol_name,
          apy_current: current,
          apy_30d_avg: avg,
          change_pct: changePct,
        },
        detectedValue: changePct,
      });
    }
  }

  return conditions;
}
