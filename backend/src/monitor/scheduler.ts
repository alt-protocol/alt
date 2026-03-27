import cron from "node-cron";
import { logger } from "../shared/logger.js";
import { db } from "./db/connection.js";
import { snapshotAllWallets as snapshotKamino } from "./services/kamino-position-fetcher.js";
import { snapshotAllWallets as snapshotDrift } from "./services/drift-position-fetcher.js";
import { snapshotAllWallets as snapshotJupiter } from "./services/jupiter-position-fetcher.js";

let task: cron.ScheduledTask | null = null;
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

  task = cron.schedule("*/15 * * * *", () => {
    void snapshotAllPositionsJob();
  });

  logger.info("Monitor scheduler started — position snapshot every 15 minutes");
}

export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
  logger.info("Monitor scheduler stopped");
}
