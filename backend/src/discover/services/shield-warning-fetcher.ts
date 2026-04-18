/**
 * Jupiter Shield warning fetcher.
 *
 * Runs every 6 hours (warnings change infrequently).
 * Collects all distinct mints from underlying_tokens across active
 * opportunities and fetches warnings via Jupiter Shield API in bulk.
 */
import { sql } from "drizzle-orm";
import { getWithRetry, jupiterHeaders } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import type { ShieldWarning } from "../../shared/types.js";
import { db } from "../db/connection.js";
import { tokenWarnings, yieldOpportunities } from "../db/schema.js";

const SHIELD_API = "https://api.jup.ag/ultra/v1/shield";
const BATCH_SIZE = 100;

interface ShieldResponse {
  warnings: Record<string, ShieldWarning[]>;
}

async function getDistinctMints(): Promise<string[]> {
  const rows = await db.execute<{ mint: string }>(
    sql`SELECT DISTINCT elem->>'mint' AS mint
        FROM ${yieldOpportunities},
             jsonb_array_elements(${yieldOpportunities.underlying_tokens}) AS elem
        WHERE ${yieldOpportunities.is_active} = true
          AND ${yieldOpportunities.underlying_tokens} IS NOT NULL
          AND elem->>'mint' IS NOT NULL`,
  );
  return rows.rows.map((r) => r.mint).filter(Boolean);
}

async function fetchBatch(
  mints: string[],
  headers: Record<string, string>,
): Promise<Record<string, ShieldWarning[]>> {
  const url = `${SHIELD_API}?mints=${mints.join(",")}`;
  try {
    const data = (await getWithRetry(url, { headers })) as ShieldResponse;
    return data?.warnings ?? {};
  } catch (err) {
    logger.warn({ err, mintCount: mints.length }, "Shield API batch failed");
    return {};
  }
}

export async function fetchShieldWarnings(): Promise<number> {
  const mints = await getDistinctMints();
  if (mints.length === 0) return 0;

  const headers = jupiterHeaders();
  const now = new Date();
  let processed = 0;

  for (let i = 0; i < mints.length; i += BATCH_SIZE) {
    const batch = mints.slice(i, i + BATCH_SIZE);
    const warnings = await fetchBatch(batch, headers);

    // Batch upsert all mints at once
    const rows = batch.map((mint) => ({
      mint,
      warnings: warnings[mint] ?? [],
      fetched_at: now,
      updated_at: now,
    }));
    await db
      .insert(tokenWarnings)
      .values(rows)
      .onConflictDoUpdate({
        target: tokenWarnings.mint,
        set: {
          warnings: sql`excluded.warnings`,
          fetched_at: sql`excluded.fetched_at`,
          updated_at: sql`excluded.updated_at`,
        },
      });
    processed += batch.length;
  }

  logger.info({ processed }, "Shield warnings fetch complete");
  return processed;
}
