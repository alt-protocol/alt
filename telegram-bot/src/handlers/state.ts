import type { PendingAction } from "../ai.js";

/**
 * Shared mutable state between handler modules.
 * Kept in a single file to avoid circular dependencies.
 */

/** Users awaiting wallet address input after /connect with no args. */
export const awaitingWallet = new Set<number>();

/** Users awaiting model ID input after clicking "Change Model". */
export const awaitingModel = new Set<number>();

/** Users awaiting API key input after clicking "Set API Key". */
export const awaitingApiKey = new Set<number>();

/** Pending mutating actions awaiting user Confirm/Cancel. */
export const pendingActions = new Map<
  number,
  PendingAction & { expiresAt: number }
>();

/** Last confirmed action result per user (for system prompt context). */
export const lastActionResult = new Map<
  number,
  { summary: string; timestamp: number }
>();
