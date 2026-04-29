import { eq, and, sql, or, gte, isNull } from "drizzle-orm";
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

  // Count both delivered (within cooldown window) AND pending (not yet delivered) records.
  // Pending records have delivered_at=NULL and must also be counted to prevent
  // duplicate deliveries within the same engine run.
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
        or(
          gte(deliveries.delivered_at, cutoff),
          isNull(deliveries.delivered_at),
        ),
      ),
    );

  return (result?.count ?? 0) < maxDeliveries;
}
