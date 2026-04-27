import type { FastifyInstance } from "fastify";
import cron from "node-cron";
import { db } from "./db/connection.js";
import { rules } from "./db/schema.js";
import { logger } from "../shared/logger.js";
import { runAlertEngine } from "./services/engine.js";
import { alertRoutes } from "./routes/alerts.js";

// ---------------------------------------------------------------------------
// Seed alert rules (idempotent)
// ---------------------------------------------------------------------------

const SEED_RULES = [
  { slug: "apy_drop", name: "APY Drop", tier: "daily", default_threshold: "20", threshold_unit: "percent", cooldown_hours: 24, max_deliveries: 1 },
  { slug: "apy_spike", name: "APY Spike", tier: "daily", default_threshold: "50", threshold_unit: "percent", cooldown_hours: 24, max_deliveries: 1 },
  { slug: "depeg", name: "Stablecoin Depeg", tier: "critical", default_threshold: "50", threshold_unit: "bps", cooldown_hours: 4, max_deliveries: 2 },
  { slug: "tvl_drop", name: "TVL Drop", tier: "daily", default_threshold: "30", threshold_unit: "percent", cooldown_hours: 24, max_deliveries: 1 },
  { slug: "new_opportunity", name: "New Opportunity", tier: "daily", default_threshold: "10", threshold_unit: "percent", cooldown_hours: 24, max_deliveries: 1 },
  { slug: "liquidation_risk", name: "Liquidation Risk", tier: "critical", default_threshold: "80", threshold_unit: "percent", cooldown_hours: 4, max_deliveries: 2 },
  { slug: "position_liquidated", name: "Position Liquidated", tier: "critical", default_threshold: "0", threshold_unit: "percent", cooldown_hours: 0, max_deliveries: 1 },
];

async function seedRules() {
  try {
    let upserted = 0;
    for (const r of SEED_RULES) {
      const result = await db
        .insert(rules)
        .values(r)
        .onConflictDoUpdate({
          target: rules.slug,
          set: {
            name: r.name,
            tier: r.tier,
            default_threshold: r.default_threshold,
            threshold_unit: r.threshold_unit,
            cooldown_hours: r.cooldown_hours,
            max_deliveries: r.max_deliveries,
          },
        });
      if (result.rowCount && result.rowCount > 0) upserted++;
    }
    logger.info({ count: upserted }, "[alert] Seeded/updated rules");
  } catch (err) {
    logger.error({ err }, "[alert] Rule seeding failed");
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

let task: cron.ScheduledTask | null = null;

function startScheduler() {
  // Run at minutes 5, 20, 35, 50 — offset from fetchers (0, 15, 30, 45)
  task = cron.schedule("5,20,35,50 * * * *", async () => {
    try {
      await runAlertEngine();
    } catch (err) {
      logger.error({ err }, "[alert] Engine run failed");
    }
  });
  logger.info("[alert] Scheduler started (every 15 min, offset by 5 min)");
}

function stopScheduler() {
  task?.stop();
  task = null;
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export async function alertPlugin(app: FastifyInstance) {
  await seedRules();
  await app.register(alertRoutes);

  app.addHook("onReady", async () => {
    startScheduler();
  });

  app.addHook("onClose", async () => {
    stopScheduler();
  });
}
