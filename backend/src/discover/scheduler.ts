import cron from "node-cron";
import { lt } from "drizzle-orm";
import { logger } from "../shared/logger.js";
import { db } from "../shared/db.js";
import { yieldSnapshots, stablecoinPriceSnapshots } from "./db/schema.js";
import { fetchKaminoYields } from "./services/kamino-fetcher.js";
import { fetchDriftYields } from "./services/drift-fetcher.js";
import { fetchJupiterYields } from "./services/jupiter-fetcher.js";
import { fetchStablecoinPrices } from "./services/stablecoin-price-fetcher.js";
import { fetchShieldWarnings } from "./services/shield-warning-fetcher.js";
import { fetchExponentYields } from "./services/exponent-fetcher.js";

const FETCHERS = [
  { name: "kamino", fn: fetchKaminoYields },
  { name: "drift", fn: fetchDriftYields },
  { name: "jupiter", fn: fetchJupiterYields },
  { name: "exponent", fn: fetchExponentYields },
  { name: "stablecoin-prices", fn: fetchStablecoinPrices },
];

let tasks: cron.ScheduledTask[] = [];
const running = new Set<string>();

async function runFetcher(fetcher: (typeof FETCHERS)[number]) {
  if (running.has(fetcher.name)) {
    logger.warn(
      { fetcher: fetcher.name },
      "Skipping — previous run still active",
    );
    return;
  }
  running.add(fetcher.name);
  try {
    const count = await fetcher.fn();
    logger.info(
      { fetcher: fetcher.name, count },
      "Fetch complete",
    );
  } catch (err) {
    logger.error(
      { err, fetcher: fetcher.name },
      "Fetch failed",
    );
  } finally {
    running.delete(fetcher.name);
  }
}

export function startScheduler() {
  // Run initial fetch in background (don't block server startup)
  runAllFetchers().catch(() => {});

  // Schedule every 15 minutes
  for (const fetcher of FETCHERS) {
    const task = cron.schedule("*/15 * * * *", () => {
      void runFetcher(fetcher);
    });
    tasks.push(task);
  }

  // Shield warnings — every 6 hours
  const shieldFetcher = { name: "shield-warnings", fn: fetchShieldWarnings };
  const shieldTask = cron.schedule("0 */6 * * *", () => {
    void runFetcher(shieldFetcher);
  });
  tasks.push(shieldTask);

  // Daily retention — delete old snapshots
  const retentionTask = cron.schedule("0 4 * * *", async () => {
    try {
      const yieldCutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const yieldResult = await db
        .delete(yieldSnapshots)
        .where(lt(yieldSnapshots.snapshot_at, yieldCutoff));
      logger.info({ cutoff: yieldCutoff, deleted: yieldResult.rowCount }, "Yield snapshot retention completed");

      const priceCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const priceResult = await db
        .delete(stablecoinPriceSnapshots)
        .where(lt(stablecoinPriceSnapshots.snapshot_at, priceCutoff));
      logger.info({ cutoff: priceCutoff, deleted: priceResult.rowCount }, "Price snapshot retention completed");
    } catch (err) {
      logger.error({ err }, "Snapshot retention failed");
    }
  });
  tasks.push(retentionTask);

  logger.info("Scheduler started — yield fetch every 15 minutes, retention daily at 04:00 UTC");
}

export function stopScheduler() {
  for (const task of tasks) {
    task.stop();
  }
  tasks = [];
  logger.info("Scheduler stopped");
}

async function runAllFetchers() {
  logger.info("Running initial yield fetch...");
  for (const fetcher of FETCHERS) {
    await runFetcher(fetcher);
  }
  // Shield warnings after main fetchers (needs underlying_tokens populated)
  await runFetcher({ name: "shield-warnings", fn: fetchShieldWarnings });
  logger.info("Initial yield fetch complete");
}
