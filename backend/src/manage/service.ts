import { hasAdapter } from "./protocols/index.js";

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
};
