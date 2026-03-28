import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "./db/connection.js";
import { logger } from "../shared/logger.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { startScheduler, stopScheduler } from "./scheduler.js";

/**
 * Ensure monitor schema columns are up-to-date.
 * Adds any columns that exist in the Drizzle schema but are missing in the DB.
 */
async function ensureSchema() {
  try {
    await db.execute(sql`
      ALTER TABLE monitor.user_positions
        ADD COLUMN IF NOT EXISTS apy_realized numeric(10,4)
    `);
    logger.info("Monitor schema check passed");
  } catch (err) {
    logger.error({ err }, "Monitor schema migration failed");
  }
}

export async function monitorPlugin(app: FastifyInstance) {
  // Ensure DB schema is up-to-date before registering routes
  await ensureSchema();

  // Register routes
  await app.register(portfolioRoutes);

  // Start scheduler after server is ready
  app.addHook("onReady", async () => {
    startScheduler();
  });

  // Stop scheduler on close
  app.addHook("onClose", async () => {
    stopScheduler();
  });
}
