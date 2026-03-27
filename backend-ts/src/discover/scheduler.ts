import cron from "node-cron";
import { logger } from "../shared/logger.js";
import { fetchKaminoYields } from "./services/kamino-fetcher.js";
import { fetchDriftYields } from "./services/drift-fetcher.js";
import { fetchJupiterYields } from "./services/jupiter-fetcher.js";

const FETCHERS = [
  { name: "kamino", fn: fetchKaminoYields },
  { name: "drift", fn: fetchDriftYields },
  { name: "jupiter", fn: fetchJupiterYields },
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

  logger.info("Scheduler started — yield fetch every 15 minutes");
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
  logger.info("Initial yield fetch complete");
}
