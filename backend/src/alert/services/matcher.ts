import { eq, and, isNull, desc } from "drizzle-orm";
import { db } from "../db/connection.js";
import { rules, userSubscriptions } from "../db/schema.js";
import { userPositions } from "../../monitor/db/schema.js";
import type { AlertCondition } from "./detectors/types.js";

// Telegram schema tables — direct read for cross-module alert matching
import { pgSchema } from "drizzle-orm/pg-core";
import { serial, integer, bigint, varchar, boolean } from "drizzle-orm/pg-core";

const tgSchema = pgSchema("telegram");
const tgUsers = tgSchema.table("users", {
  id: serial("id").primaryKey(),
  telegram_id: bigint("telegram_id", { mode: "bigint" }).notNull(),
  chat_id: bigint("chat_id", { mode: "bigint" }).notNull(),
  wallet_address: varchar("wallet_address", { length: 255 }),
});
const tgPrefs = tgSchema.table("user_preferences", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull(),
  alerts_enabled: boolean("alerts_enabled").notNull(),
  quiet_hours_start: integer("quiet_hours_start"),
  quiet_hours_end: integer("quiet_hours_end"),
  digest_hour_utc: integer("digest_hour_utc"),
});

export interface UserMatch {
  userId: number;
  chatId: bigint;
  walletAddress: string | null;
  condition: AlertCondition;
  rule: {
    id: number;
    slug: string;
    tier: string;
    cooldownHours: number;
    maxDeliveries: number;
  };
  effectiveThreshold: number;
}

interface RuleRow {
  id: number;
  slug: string;
  tier: string;
  default_threshold: string | null;
  cooldown_hours: number;
  max_deliveries: number;
}

/**
 * Match detected conditions to users who should be notified.
 * Loads all alert-enabled users, their positions, and subscription overrides.
 * Returns a flat list of matches ready for cooldown check + routing.
 */
export async function matchConditionsToUsers(
  conditions: AlertCondition[],
): Promise<UserMatch[]> {
  if (conditions.length === 0) return [];

  // 1. Load rules by slug (for conditions we detected)
  const slugs = [...new Set(conditions.map((c) => c.ruleSlug))];
  const allRules = await db.select().from(rules).where(eq(rules.is_active, true));
  const ruleMap = new Map<string, RuleRow>();
  for (const r of allRules) {
    ruleMap.set(r.slug, r);
  }

  // 2. Load alert-enabled users
  const users = await db
    .select({
      id: tgUsers.id,
      chat_id: tgUsers.chat_id,
      wallet_address: tgUsers.wallet_address,
    })
    .from(tgUsers)
    .innerJoin(tgPrefs, eq(tgPrefs.user_id, tgUsers.id))
    .where(eq(tgPrefs.alerts_enabled, true));

  if (users.length === 0) return [];

  // 3. Load user positions → Map<wallet, Set<opportunityId>>
  const wallets = users
    .map((u) => u.wallet_address)
    .filter((w): w is string => w !== null);

  const positionMap = new Map<string, Set<number>>();
  if (wallets.length > 0) {
    // Get latest non-closed positions for all wallets
    const positions = await db
      .select({
        wallet_address: userPositions.wallet_address,
        opportunity_id: userPositions.opportunity_id,
      })
      .from(userPositions)
      .where(
        and(
          eq(userPositions.is_closed, false),
        ),
      );

    for (const p of positions) {
      if (!p.opportunity_id) continue;
      let set = positionMap.get(p.wallet_address);
      if (!set) {
        set = new Set();
        positionMap.set(p.wallet_address, set);
      }
      set.add(p.opportunity_id);
    }
  }

  // 4. Load user subscription overrides → Map<userId, Map<ruleId, {enabled, threshold}>>
  const subs = await db.select().from(userSubscriptions);
  const subMap = new Map<number, Map<number, { enabled: boolean; threshold: number | null }>>();
  for (const s of subs) {
    let userSubs = subMap.get(s.user_id);
    if (!userSubs) {
      userSubs = new Map();
      subMap.set(s.user_id, userSubs);
    }
    userSubs.set(s.rule_id, {
      enabled: s.enabled,
      threshold: s.threshold ? Number(s.threshold) : null,
    });
  }

  // 5. Match: conditions × users
  const matches: UserMatch[] = [];

  for (const condition of conditions) {
    const rule = ruleMap.get(condition.ruleSlug);
    if (!rule) continue;

    const defaultThreshold = rule.default_threshold ? Number(rule.default_threshold) : 0;

    for (const user of users) {
      // Check subscription override
      const sub = subMap.get(user.id)?.get(rule.id);
      if (sub?.enabled === false) continue;

      // Get effective threshold
      const threshold = sub?.threshold ?? defaultThreshold;

      // Check if detected value exceeds threshold
      if (condition.detectedValue < threshold) continue;

      // Check if user is affected by this condition
      if (!isUserAffected(user.wallet_address, condition, positionMap)) continue;

      matches.push({
        userId: user.id,
        chatId: user.chat_id,
        walletAddress: user.wallet_address,
        condition,
        rule: {
          id: rule.id,
          slug: rule.slug,
          tier: rule.tier,
          cooldownHours: rule.cooldown_hours,
          maxDeliveries: rule.max_deliveries,
        },
        effectiveThreshold: threshold,
      });
    }
  }

  return matches;
}

/**
 * Check if a user is affected by a condition.
 * - opp:* conditions: user must hold that opportunity
 * - token:* conditions: user holds any opportunity with that token (broad match)
 * - For new_opportunity: all users are potential targets (discovery)
 */
function isUserAffected(
  walletAddress: string | null,
  condition: AlertCondition,
  positionMap: Map<string, Set<number>>,
): boolean {
  // New opportunities are broadcast to all alert-enabled users
  if (condition.ruleSlug === "new_opportunity") return true;

  // Depeg: all users with any position (stablecoin risk is broad)
  if (condition.ruleSlug === "depeg") return walletAddress !== null;

  // Position-specific: user must hold the opportunity
  if (condition.entityKey.startsWith("opp:")) {
    if (!walletAddress) return false;
    const oppId = parseInt(condition.entityKey.split(":")[1], 10);
    const userOpps = positionMap.get(walletAddress);
    return userOpps?.has(oppId) ?? false;
  }

  return false;
}
