import cron from "node-cron";
import { sql } from "drizzle-orm";
import { logger } from "../shared/logger.js";
import { db } from "../shared/db.js";
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

/** Delete rows in batches to avoid long locks and WAL spikes. */
async function batchDelete(tableName: string, whereClause: string): Promise<number> {
  let total = 0;
  let deleted: number;
  do {
    const result = await db.execute(sql.raw(`
      DELETE FROM ${tableName}
      WHERE id IN (
        SELECT id FROM ${tableName}
        WHERE ${whereClause}
        LIMIT 5000
      )
    `));
    deleted = result.rowCount ?? 0;
    total += deleted;
  } while (deleted > 0);
  return total;
}

/** Compact + retain discover snapshots. Runs daily at midnight UTC. */
async function compactAndRetainSnapshots() {
  try {
    // --- yield_snapshots: compact raw data older than 30 days to 1 row/day ---
    const compactedYields = await db.execute(sql`
      INSERT INTO discover.yield_snapshots (opportunity_id, apy, tvl_usd, snapshot_at, source)
      SELECT
        opportunity_id,
        AVG(apy::numeric),
        AVG(tvl_usd::numeric),
        date_trunc('day', snapshot_at) + INTERVAL '12 hours',
        'daily_avg'
      FROM discover.yield_snapshots
      WHERE snapshot_at < NOW() - INTERVAL '30 days'
        AND (source IS NULL OR source != 'daily_avg')
      GROUP BY opportunity_id, date_trunc('day', snapshot_at)
      ON CONFLICT DO NOTHING
    `);
    logger.info({ inserted: compactedYields.rowCount }, "Yield snapshot compaction: daily averages inserted");

    const deletedRawYields = await batchDelete(
      "discover.yield_snapshots",
      "snapshot_at < NOW() - INTERVAL '30 days' AND (source IS NULL OR source != 'daily_avg')",
    );
    logger.info({ deleted: deletedRawYields }, "Yield snapshot compaction: raw rows deleted");

    const deletedOldYields = await batchDelete(
      "discover.yield_snapshots",
      "snapshot_at < NOW() - INTERVAL '365 days'",
    );
    logger.info({ deleted: deletedOldYields }, "Yield snapshot retention: old daily rows deleted");

    // --- stablecoin_price_snapshots: compact raw data older than 7 days ---
    const compactedPrices = await db.execute(sql`
      INSERT INTO discover.stablecoin_price_snapshots (mint, symbol, price_usd, snapshot_at)
      SELECT
        mint, symbol,
        AVG(price_usd::numeric),
        date_trunc('day', snapshot_at) + INTERVAL '12 hours'
      FROM discover.stablecoin_price_snapshots
      WHERE snapshot_at < NOW() - INTERVAL '7 days'
        AND EXTRACT(HOUR FROM snapshot_at) != 12
      GROUP BY mint, symbol, date_trunc('day', snapshot_at)
      ON CONFLICT DO NOTHING
    `);
    logger.info({ inserted: compactedPrices.rowCount }, "Price snapshot compaction: daily averages inserted");

    const deletedRawPrices = await batchDelete(
      "discover.stablecoin_price_snapshots",
      "snapshot_at < NOW() - INTERVAL '7 days' AND EXTRACT(HOUR FROM snapshot_at) != 12",
    );
    logger.info({ deleted: deletedRawPrices }, "Price snapshot compaction: raw rows deleted");

    const deletedOldPrices = await batchDelete(
      "discover.stablecoin_price_snapshots",
      "snapshot_at < NOW() - INTERVAL '90 days'",
    );
    logger.info({ deleted: deletedOldPrices }, "Price snapshot retention: old daily rows deleted");
  } catch (err) {
    logger.error({ err }, "Snapshot compaction/retention failed");
  }
}

export function startScheduler() {
  // Run initial fetch in background only in development (production uses existing DB data)
  if (process.env.NODE_ENV !== "production") {
    runAllFetchers().catch(() => {});
  }

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

  // Daily compaction + retention at midnight UTC
  const compactionTask = cron.schedule("0 0 * * *", () => {
    void compactAndRetainSnapshots();
  });
  tasks.push(compactionTask);

  logger.info("Scheduler started — yield fetch every 15 min, compaction daily at 00:00 UTC");
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
