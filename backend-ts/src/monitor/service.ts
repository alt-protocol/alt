/**
 * MonitorService — public interface for cross-module reads.
 */
import { eq, and } from "drizzle-orm";
import { db } from "./db/connection.js";
import { trackedWallets, userPositions } from "./db/schema.js";

function numOrNull(val: string | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export const monitorService = {
  async getWalletStatus(walletAddress: string) {
    const rows = await db
      .select()
      .from(trackedWallets)
      .where(eq(trackedWallets.wallet_address, walletAddress))
      .limit(1);
    if (rows.length === 0) return null;
    return {
      wallet_address: rows[0].wallet_address,
      fetch_status: rows[0].fetch_status,
      last_fetched_at: rows[0].last_fetched_at,
      is_active: rows[0].is_active,
    };
  },

  async trackWallet(walletAddress: string) {
    const existing = await db
      .select({ id: trackedWallets.id })
      .from(trackedWallets)
      .where(eq(trackedWallets.wallet_address, walletAddress))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(trackedWallets)
        .set({ is_active: true })
        .where(eq(trackedWallets.wallet_address, walletAddress));
    } else {
      await db
        .insert(trackedWallets)
        .values({ wallet_address: walletAddress });
    }
  },
};
