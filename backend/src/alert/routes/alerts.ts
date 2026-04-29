import type { FastifyInstance } from "fastify";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { deliveries, events, rules, userSubscriptions } from "../db/schema.js";
import { getSummaryUsers, buildPortfolioSummary, formatDailyTemplate, formatWeeklyTemplate } from "../services/portfolio-summary.js";

export async function alertRoutes(app: FastifyInstance) {
  // GET /pending — Bot polls for undelivered critical alerts
  app.get<{
    Querystring: { tier?: string; limit?: string };
  }>("/pending", async (request) => {
    const tier = request.query.tier ?? "critical";
    const limit = Math.min(Number(request.query.limit) || 20, 50);

    const rows = await db
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

    // Convert BigInt chat_id to string for JSON serialization
    return { alerts: rows.map((r) => ({ ...r, chat_id: String(r.chat_id) })) };
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

  // Digest endpoints removed — daily summary is now portfolio-centric (GET /daily/:walletAddress)

  // GET /summary/users — Users eligible for daily/weekly summaries
  app.get("/summary/users", async () => {
    const users = await getSummaryUsers();
    return {
      users: users.map((u) => ({
        user_id: u.userId,
        chat_id: String(u.chatId),
        wallet_address: u.walletAddress,
      })),
    };
  });

  // GET /daily/:walletAddress — Daily portfolio snapshot
  app.get<{ Params: { walletAddress: string } }>("/daily/:walletAddress", async (request, reply) => {
    const { walletAddress } = request.params;
    if (!walletAddress) return reply.status(400).send({ error: "Wallet address required" });

    const data = await buildPortfolioSummary(walletAddress);
    const template = formatDailyTemplate(data);

    return { ...data, template };
  });

  // GET /weekly/:walletAddress — Weekly portfolio review
  app.get<{ Params: { walletAddress: string } }>("/weekly/:walletAddress", async (request, reply) => {
    const { walletAddress } = request.params;
    if (!walletAddress) return reply.status(400).send({ error: "Wallet address required" });

    const data = await buildPortfolioSummary(walletAddress);
    const template = formatWeeklyTemplate(data);

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

  // -------------------------------------------------------------------------
  // Test endpoints (dev only)
  // -------------------------------------------------------------------------

  if (process.env.NODE_ENV === "production") return;

  // POST /test/critical — Insert a fake critical alert for bot to deliver
  app.post<{
    Body: { user_id: number; chat_id: string };
  }>("/test/critical", async (request, reply) => {
    const { user_id, chat_id } = request.body as { user_id: number; chat_id: string };
    if (!user_id || !chat_id) return reply.status(400).send({ error: "user_id and chat_id required" });

    // Find the depeg rule for a realistic test
    const [depegRule] = await db.select({ id: rules.id }).from(rules).where(eq(rules.slug, "depeg")).limit(1);
    if (!depegRule) return reply.status(500).send({ error: "Depeg rule not seeded" });

    const entityKey = `test:${Date.now()}`;
    const title = "[TEST] Stablecoin Depeg Alert";
    const body = "USDC price deviation: $0.985 (-150 bps from peg). This is a test alert.";

    const [event] = await db
      .insert(events)
      .values({
        rule_id: depegRule.id,
        entity_key: entityKey,
        tier: "critical",
        title,
        body,
        metadata: { test: true },
        detected_value: "150",
      })
      .returning({ id: events.id });

    const [delivery] = await db
      .insert(deliveries)
      .values({
        user_id,
        chat_id: BigInt(chat_id),
        event_id: event.id,
        rule_id: depegRule.id,
        entity_key: entityKey,
        delivery_type: "immediate",
        message_text: `${title}\n${body}`,
        delivered_at: null,
      })
      .returning({ id: deliveries.id });

    return { success: true, delivery_id: delivery.id, message: "Critical alert queued. Bot will deliver within 60s." };
  });

  // POST /test/run — Seed a test critical alert + trigger daily/weekly via real data
  app.post("/test/run", async () => {
    const users = await getSummaryUsers();
    if (users.length === 0) {
      return { error: "No alert-enabled users found. Run /start in Telegram first." };
    }

    const allRules = await db.select({ id: rules.id, slug: rules.slug }).from(rules);
    const depegRuleId = allRules.find((r) => r.slug === "depeg")?.id;

    let criticalCount = 0;

    for (const user of users) {
      if (depegRuleId) {
        const entityKey = `test:${Date.now()}:critical`;
        const title = "[TEST] Stablecoin Depeg Alert";
        const body = "USDC price deviation: $0.985 (-150 bps from peg). This is a test alert.";

        const [event] = await db
          .insert(events)
          .values({
            rule_id: depegRuleId,
            entity_key: entityKey,
            tier: "critical",
            title,
            body,
            metadata: { test: true },
            detected_value: "150",
          })
          .returning({ id: events.id });

        await db.insert(deliveries).values({
          user_id: user.userId,
          chat_id: user.chatId,
          event_id: event.id,
          rule_id: depegRuleId,
          entity_key: entityKey,
          delivery_type: "immediate",
          message_text: `${title}\n${body}`,
          delivered_at: null,
        });
        criticalCount++;
      }
    }

    return {
      success: true,
      users_seeded: users.length,
      critical_count: criticalCount,
      message: "Critical alert seeded. Daily + weekly summaries use real portfolio data — bot delivers within ~60s.",
    };
  });
}
