import { db } from "../db/connection.js";
import { events, deliveries } from "../db/schema.js";
import { logger } from "../../shared/logger.js";
import { detectApyChanges } from "./detectors/apy.js";
import { detectDepegEvents } from "./detectors/depeg.js";
import { detectTvlDrops } from "./detectors/tvl.js";
import { detectNewOpportunities } from "./detectors/new-opportunity.js";
import { matchConditionsToUsers, type UserMatch } from "./matcher.js";
import { canDeliver } from "./cooldown.js";
import type { AlertCondition } from "./detectors/types.js";

/**
 * Main alert engine — runs every 15 min.
 * 1. Detect conditions across all opportunities
 * 2. Write events to audit log
 * 3. Match events to affected users
 * 4. Route by tier: critical → pending delivery, daily → digest queue
 */
export async function runAlertEngine(): Promise<void> {
  const start = Date.now();

  // 1. Detect conditions
  const [apyConditions, depegConditions, tvlConditions, newOppConditions] =
    await Promise.all([
      detectApyChanges().catch((err) => {
        logger.error({ err }, "APY detector failed");
        return [] as AlertCondition[];
      }),
      detectDepegEvents().catch((err) => {
        logger.error({ err }, "Depeg detector failed");
        return [] as AlertCondition[];
      }),
      detectTvlDrops().catch((err) => {
        logger.error({ err }, "TVL detector failed");
        return [] as AlertCondition[];
      }),
      detectNewOpportunities().catch((err) => {
        logger.error({ err }, "New opportunity detector failed");
        return [] as AlertCondition[];
      }),
    ]);

  const allConditions = [
    ...apyConditions,
    ...depegConditions,
    ...tvlConditions,
    ...newOppConditions,
  ];

  if (allConditions.length === 0) {
    logger.debug("[alert] No conditions detected");
    return;
  }

  logger.info(
    { count: allConditions.length, apy: apyConditions.length, depeg: depegConditions.length, tvl: tvlConditions.length, newOpp: newOppConditions.length },
    "[alert] Conditions detected",
  );

  // 2. Match conditions to users
  const matches = await matchConditionsToUsers(allConditions);
  if (matches.length === 0) {
    logger.debug("[alert] No user matches");
    return;
  }

  logger.info({ matches: matches.length }, "[alert] User matches found");

  // 3. Route by tier with cooldown check
  let criticalCount = 0;
  let digestCount = 0;
  let skippedCount = 0;

  for (const match of matches) {
    const allowed = await canDeliver(
      match.userId,
      match.rule.id,
      match.condition.entityKey,
      match.rule.cooldownHours,
      match.rule.maxDeliveries,
    );

    if (!allowed) {
      skippedCount++;
      continue;
    }

    // Write event to audit log
    const [event] = await db
      .insert(events)
      .values({
        rule_id: match.rule.id,
        entity_key: match.condition.entityKey,
        tier: match.rule.tier,
        title: match.condition.title,
        body: match.condition.body,
        metadata: match.condition.metadata,
        detected_value: String(match.condition.detectedValue),
      })
      .returning({ id: events.id });

    if (match.rule.tier === "critical") {
      // Write pending delivery — bot polls for delivered_at IS NULL
      await db.insert(deliveries).values({
        user_id: match.userId,
        chat_id: match.chatId,
        event_id: event.id,
        rule_id: match.rule.id,
        entity_key: match.condition.entityKey,
        delivery_type: "immediate",
        message_text: `${match.condition.title}\n${match.condition.body}`,
        delivered_at: null,
      });
      criticalCount++;
    } else {
      // Daily tier → log for cooldown tracking only (daily summary is portfolio-centric now)
      await db.insert(deliveries).values({
        user_id: match.userId,
        chat_id: match.chatId,
        event_id: event.id,
        rule_id: match.rule.id,
        entity_key: match.condition.entityKey,
        delivery_type: "digest",
        message_text: `${match.condition.title}\n${match.condition.body}`,
        delivered_at: new Date(),
      });
      digestCount++;
    }
  }

  const elapsed = Date.now() - start;
  logger.info(
    { critical: criticalCount, digest: digestCount, skipped: skippedCount, elapsed_ms: elapsed },
    "[alert] Engine run complete",
  );
}
