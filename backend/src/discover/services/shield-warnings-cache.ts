/**
 * Cached shield warnings loader — avoids querying token_warnings on every
 * /yields request. Cache TTL is 10 minutes; data updates every 6 hours.
 */
import { db } from "../db/connection.js";
import { tokenWarnings } from "../db/schema.js";
import { cachedAsync } from "../../shared/utils.js";
import type { ShieldWarning } from "../../shared/types.js";

export async function getShieldWarningsMap(): Promise<Map<string, ShieldWarning[]>> {
  return cachedAsync("shield-warnings-map", 10 * 60_000, async () => {
    const rows = await db.select().from(tokenWarnings);
    const map = new Map<string, ShieldWarning[]>();
    for (const row of rows) {
      const warnings = row.warnings as ShieldWarning[];
      if (warnings.length > 0) {
        map.set(row.mint, warnings);
      }
    }
    return map;
  });
}
