import { eq, and, gte, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { deliveries } from "../db/schema.js";

/**
 * Check if an alert can be delivered based on cooldown rules.
 * Returns true if delivery is allowed.
 */
export async function canDeliver(
  userId: number,
  ruleId: number,
  entityKey: string,
  cooldownHours: number,
  maxDeliveries: number,
): Promise<boolean> {
  // Special case: max_deliveries=0 means no cooldown (e.g., position_liquidated)
  if (maxDeliveries === 0) return true;

  const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

  const [result] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.user_id, userId),
        eq(deliveries.rule_id, ruleId),
        eq(deliveries.entity_key, entityKey),
        gte(deliveries.delivered_at, cutoff),
      ),
    );

  return (result?.count ?? 0) < maxDeliveries;
}
