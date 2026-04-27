import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { deliveries, digestQueue, rules, userSubscriptions } from "../db/schema.js";
import { getWeeklySummaryUsers, buildWeeklySummary, formatWeeklySummaryTemplate } from "../services/weekly-summary.js";
import { pgSchema, serial, integer, bigint, boolean } from "drizzle-orm/pg-core";

// Cross-schema read for telegram user preferences
const tgSchema = pgSchema("telegram");
const tgUsers = tgSchema.table("users", {
  id: serial("id").primaryKey(),
  chat_id: bigint("chat_id", { mode: "bigint" }).notNull(),
});
const tgPrefs = tgSchema.table("user_preferences", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull(),
  alerts_enabled: boolean("alerts_enabled").notNull(),
  digest_hour_utc: integer("digest_hour_utc"),
});

export async function alertRoutes(app: FastifyInstance) {
  // GET /pending — Bot polls for undelivered critical alerts
  app.get<{
    Querystring: { tier?: string; limit?: string };
  }>("/pending", async (request) => {
    const tier = request.query.tier ?? "critical";
    const limit = Math.min(Number(request.query.limit) || 20, 50);

    const pending = await db
      .select({
        id: deliveries.id,
        user_id: deliveries.user_id,
        chat_id: deliveries.chat_id,
        event_id: deliveries.event_id,
        rule_id: deliveries.rule_id,
        entity_key: deliveries.entity_key,
        delivery_type: deliveries.delivery_type,
        message_text: deliveries.message_text,
      })
      .from(deliveries)
      .where(
        and(
          isNull(deliveries.delivered_at),
          eq(deliveries.delivery_type, "immediate"),
        ),
      )
      .limit(limit);

    return { alerts: pending };
  });

  // POST /:id/delivered — Bot marks an alert as delivered
  app.post<{
    Params: { id: string };
  }>("/:id/delivered", async (request, reply) => {
    const id = Number(request.params.id);
    if (!id) return reply.status(400).send({ error: "Invalid delivery ID" });

    const result = await db
      .update(deliveries)
      .set({ delivered_at: new Date() })
      .where(
        and(
          eq(deliveries.id, id),
          isNull(deliveries.delivered_at),
        ),
      )
      .returning({ id: deliveries.id });

    if (result.length === 0) {
      return reply.status(404).send({ error: "Delivery not found or already delivered" });
    }

    return { success: true };
  });

  // GET /digest-ready — Users whose digest_hour_utc matches current UTC hour and have queued items
  app.get("/digest-ready", async () => {
    const currentHour = new Date().getUTCHours();

    const ready = await db
      .select({
        user_id: digestQueue.user_id,
        item_count: sql<number>`count(*)::int`,
      })
      .from(digestQueue)
      .innerJoin(tgPrefs, eq(tgPrefs.user_id, digestQueue.user_id))
      .where(eq(tgPrefs.digest_hour_utc, currentHour))
      .groupBy(digestQueue.user_id);

    // Get chat_ids for ready users
    const userIds = ready.map((r) => r.user_id);
    if (userIds.length === 0) return { users: [] };

    const users = await db
      .select({ id: tgUsers.id, chat_id: tgUsers.chat_id })
      .from(tgUsers)
      .where(sql`${tgUsers.id} = ANY(${userIds})`);

    const chatMap = new Map(users.map((u) => [u.id, u.chat_id]));

    return {
      users: ready.map((r) => ({
        user_id: r.user_id,
        chat_id: String(chatMap.get(r.user_id) ?? 0),
        item_count: r.item_count,
      })),
    };
  });

  // GET /digest/:userId — Fetch all digest items for a user, grouped by rule
  app.get<{ Params: { userId: string } }>("/digest/:userId", async (request, reply) => {
    const userId = Number(request.params.userId);
    if (!userId) return reply.status(400).send({ error: "Invalid user ID" });

    const items = await db
      .select({
        id: digestQueue.id,
        rule_id: digestQueue.rule_id,
        title: digestQueue.title,
        body: digestQueue.body,
        metadata: digestQueue.metadata,
        created_at: digestQueue.created_at,
      })
      .from(digestQueue)
      .where(eq(digestQueue.user_id, userId))
      .orderBy(digestQueue.created_at);

    // Get rule names for grouping
    const ruleIds = [...new Set(items.map((i) => i.rule_id))];
    const ruleRows = ruleIds.length > 0
      ? await db.select({ id: rules.id, name: rules.name, slug: rules.slug }).from(rules).where(sql`${rules.id} = ANY(${ruleIds})`)
      : [];
    const ruleMap = new Map(ruleRows.map((r) => [r.id, r]));

    // Group items by rule
    const grouped: Record<string, Array<{ title: string; body: string; metadata: unknown }>> = {};
    for (const item of items) {
      const rule = ruleMap.get(item.rule_id);
      const key = rule?.name ?? "Other";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({ title: item.title, body: item.body, metadata: item.metadata });
    }

    return { items, grouped, total: items.length };
  });

  // POST /digest/:userId/delivered — Clear digest queue and record delivery
  app.post<{ Params: { userId: string } }>("/digest/:userId/delivered", async (request, reply) => {
    const userId = Number(request.params.userId);
    if (!userId) return reply.status(400).send({ error: "Invalid user ID" });

    // Get items before clearing
    const items = await db
      .select({ id: digestQueue.id, rule_id: digestQueue.rule_id })
      .from(digestQueue)
      .where(eq(digestQueue.user_id, userId));

    if (items.length === 0) return { success: true, cleared: 0 };

    // Clear the queue
    await db.delete(digestQueue).where(eq(digestQueue.user_id, userId));

    return { success: true, cleared: items.length };
  });

  // GET /weekly/users — Users eligible for weekly summary
  app.get("/weekly/users", async () => {
    const users = await getWeeklySummaryUsers();
    return {
      users: users.map((u) => ({
        user_id: u.userId,
        chat_id: String(u.chatId),
        wallet_address: u.walletAddress,
      })),
    };
  });

  // GET /weekly/:walletAddress — Build weekly summary data for a wallet
  app.get<{ Params: { walletAddress: string } }>("/weekly/:walletAddress", async (request, reply) => {
    const { walletAddress } = request.params;
    if (!walletAddress) return reply.status(400).send({ error: "Wallet address required" });

    const data = await buildWeeklySummary(walletAddress);
    const template = formatWeeklySummaryTemplate(data);

    return { ...data, template };
  });

  // GET /subscriptions/:userId — Get user's alert rules with effective state
  app.get<{ Params: { userId: string } }>("/subscriptions/:userId", async (request, reply) => {
    const userId = Number(request.params.userId);
    if (!userId) return reply.status(400).send({ error: "Invalid user ID" });

    const allRules = await db
      .select()
      .from(rules)
      .where(eq(rules.is_active, true));

    const subs = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.user_id, userId));

    const subMap = new Map(subs.map((s) => [s.rule_id, s]));

    return {
      rules: allRules.map((r) => {
        const sub = subMap.get(r.id);
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          tier: r.tier,
          default_threshold: r.default_threshold,
          threshold_unit: r.threshold_unit,
          enabled: sub?.enabled ?? true,
          threshold: sub?.threshold ?? r.default_threshold,
        };
      }),
    };
  });

  // POST /subscriptions/:userId/toggle — Toggle a rule on/off for a user
  app.post<{
    Params: { userId: string };
    Body: { rule_id: number; enabled: boolean };
  }>("/subscriptions/:userId/toggle", async (request, reply) => {
    const userId = Number(request.params.userId);
    const { rule_id, enabled } = request.body as { rule_id: number; enabled: boolean };
    if (!userId || !rule_id) return reply.status(400).send({ error: "user_id and rule_id required" });

    await db
      .insert(userSubscriptions)
      .values({ user_id: userId, rule_id, enabled })
      .onConflictDoUpdate({
        target: [userSubscriptions.user_id, userSubscriptions.rule_id],
        set: { enabled },
      });

    return { success: true, rule_id, enabled };
  });
}
