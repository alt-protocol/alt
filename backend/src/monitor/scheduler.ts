import cron from "node-cron";
import { lt } from "drizzle-orm";
import { logger } from "../shared/logger.js";
import { db } from "./db/connection.js";
import { userPositions } from "./db/schema.js";
import { snapshotAllWallets as snapshotKamino } from "./services/kamino-position-fetcher.js";
import { snapshotAllWallets as snapshotDrift } from "./services/drift-position-fetcher.js";
import { snapshotAllWallets as snapshotJupiter } from "./services/jupiter-position-fetcher.js";

let task: cron.ScheduledTask | null = null;
let retentionTask: cron.ScheduledTask | null = null;
let running = false;

async function snapshotAllPositionsJob() {
  if (running) {
    logger.warn("Skipping position snapshot — previous run still active");
    return;
  }
  running = true;

  const now = new Date();
  try {
    const kaminoCount = await snapshotKamino(db, now);
    const driftCount = await snapshotDrift(db, now);
    const jupiterCount = await snapshotJupiter(db, now);
    logger.info(
      { kaminoCount, driftCount, jupiterCount },
      "Position snapshot complete",
    );
  } catch (err) {
    logger.error({ err }, "Position snapshot job failed");
  } finally {
    running = false;
  }
}

export function startScheduler() {
  // Run initial snapshot in background
  snapshotAllPositionsJob().catch(() => {});

  task = cron.schedule("15 */4 * * *", () => {
    void snapshotAllPositionsJob();
  });

  // Daily retention — delete position snapshots older than 365 days
  retentionTask = cron.schedule("0 4 * * *", async () => {
    try {
      const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const result = await db
        .delete(userPositions)
        .where(lt(userPositions.snapshot_at, cutoff));
      logger.info({ cutoff, deleted: result.rowCount }, "Position snapshot retention completed");
    } catch (err) {
      logger.error({ err }, "Position snapshot retention failed");
    }
  });

  logger.info("Monitor scheduler started — position snapshot every 4 hours (15 min after discover), retention daily at 04:00 UTC");
}

export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
  if (retentionTask) {
    retentionTask.stop();
    retentionTask = null;
  }
  logger.info("Monitor scheduler stopped");
}
