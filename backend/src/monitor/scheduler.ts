import cron from "node-cron";
import { sql } from "drizzle-orm";
import { logger } from "../shared/logger.js";
import { db } from "./db/connection.js";
import { snapshotAllWallets as snapshotKamino } from "./services/kamino-position-fetcher.js";
import { snapshotAllWallets as snapshotDrift } from "./services/drift-position-fetcher.js";
import { snapshotAllWallets as snapshotJupiter } from "./services/jupiter-position-fetcher.js";

let task: cron.ScheduledTask | null = null;
let compactionTask: cron.ScheduledTask | null = null;
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

/** Compact + retain user position snapshots. Runs daily at midnight UTC. */
async function compactAndRetainPositions() {
  try {
    // Step 1: Insert daily summary (last snapshot of each day per wallet/protocol/position)
    const compacted = await db.execute(sql`
      INSERT INTO monitor.user_positions (
        wallet_address, protocol_slug, product_type, external_id,
        opportunity_id, deposit_amount, deposit_amount_usd, pnl_usd, pnl_pct,
        initial_deposit_usd, opened_at, held_days, apy, apy_realized,
        is_closed, closed_at, close_value_usd, token_symbol,
        extra_data, underlying_tokens, snapshot_at
      )
      SELECT DISTINCT ON (wallet_address, protocol_slug, external_id, date_trunc('day', snapshot_at))
        wallet_address, protocol_slug, product_type, external_id,
        opportunity_id, deposit_amount, deposit_amount_usd, pnl_usd, pnl_pct,
        initial_deposit_usd, opened_at, held_days, apy, apy_realized,
        is_closed, closed_at, close_value_usd, token_symbol,
        extra_data, underlying_tokens,
        date_trunc('day', snapshot_at) + INTERVAL '12 hours'
      FROM monitor.user_positions
      WHERE snapshot_at < NOW() - INTERVAL '30 days'
        AND EXTRACT(HOUR FROM snapshot_at) != 12
      ORDER BY wallet_address, protocol_slug, external_id, date_trunc('day', snapshot_at), snapshot_at DESC
    `);
    logger.info({ inserted: compacted.rowCount }, "Position compaction: daily summaries inserted");

    // Step 2: Delete raw rows older than 30 days (keep noon compacted rows)
    const deletedRaw = await batchDelete(
      "monitor.user_positions",
      "snapshot_at < NOW() - INTERVAL '30 days' AND EXTRACT(HOUR FROM snapshot_at) != 12",
    );
    logger.info({ deleted: deletedRaw }, "Position compaction: raw rows deleted");

    // Step 3: Delete compacted rows older than 365 days
    const deletedOld = await batchDelete(
      "monitor.user_positions",
      "snapshot_at < NOW() - INTERVAL '365 days'",
    );
    logger.info({ deleted: deletedOld }, "Position retention: old daily rows deleted");
  } catch (err) {
    logger.error({ err }, "Position compaction/retention failed");
  }
}

export function startScheduler() {
  // Run initial snapshot in background only in development
  if (process.env.NODE_ENV !== "production") {
    snapshotAllPositionsJob().catch(() => {});
  }

  task = cron.schedule("15 */4 * * *", () => {
    void snapshotAllPositionsJob();
  });

  // Daily compaction + retention at midnight UTC
  compactionTask = cron.schedule("0 0 * * *", () => {
    void compactAndRetainPositions();
  });

  logger.info("Monitor scheduler started — position snapshot every 4 hours, compaction daily at 00:00 UTC");
}

export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
  if (compactionTask) {
    compactionTask.stop();
    compactionTask = null;
  }
  logger.info("Monitor scheduler stopped");
}
