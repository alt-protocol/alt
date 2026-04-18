import { hasAdapter, getAdapter } from "./protocols/index.js";
import { discoverService } from "../discover/service.js";
import { logger } from "../shared/logger.js";

/**
 * ManageService — public interface for cross-module reads.
 *
 * Minimal for now. The Manage module is primarily consumed via HTTP routes.
 * This interface exists for structural consistency and future cross-module needs.
 */
export const manageService = {
  /** Check if a protocol has a transaction-building adapter. */
  hasAdapterForProtocol(slug: string): boolean {
    return hasAdapter(slug);
  },

  /** Fetch on-chain balance for a specific position via the protocol adapter. */
  async getBalance(
    opportunityId: number,
    walletAddress: string,
    extraMetadata?: Record<string, unknown>,
  ): Promise<number | null> {
    const opp = await discoverService.getOpportunityById(opportunityId);
    if (!opp || !opp.protocol?.slug || !opp.deposit_address) return null;

    const adapter = await getAdapter(opp.protocol.slug);
    if (!adapter?.getBalance) return null;

    try {
      return await adapter.getBalance({
        walletAddress,
        depositAddress: opp.deposit_address,
        category: opp.category,
        extraData: { ...(opp.extra_data as Record<string, unknown> ?? {}), ...extraMetadata },
      });
    } catch (err) {
      logger.error(
        { err, opportunityId, wallet: walletAddress.slice(0, 8) },
        "manageService.getBalance failed",
      );
      return null;
    }
  },
};
