/**
 * Post-sign position poller.
 *
 * After the bot sends a sign link, polls the monitor API to detect when the
 * user's position appears or changes. Sends a Telegram notification on success.
 */

import type { Api } from "grammy";
import { apiGet, apiPost } from "../api-client.js";

const POLL_INTERVAL_MS = 15_000;
const MAX_POLLS = 12; // 12 × 15s = 3 minutes

interface Position {
  opportunity_id: number;
  deposit_usd: number;
  [key: string]: unknown;
}

/**
 * Poll the monitor API for a position matching the given opportunity.
 * Runs in the background — does not block the caller.
 */
export function pollForPosition(
  api: Api,
  chatId: number,
  walletAddress: string,
  opportunityId: number,
  summary: string,
): void {
  // Fire and forget — errors are logged, not thrown
  void doPoll(api, chatId, walletAddress, opportunityId, summary);
}

async function doPoll(
  api: Api,
  chatId: number,
  walletAddress: string,
  opportunityId: number,
  summary: string,
): Promise<void> {
  try {
    // Take a snapshot of existing positions before the tx
    const before = await getPositionBalance(walletAddress, opportunityId);

    // Trigger a fresh portfolio fetch
    await apiPost(`/api/monitor/portfolio/${walletAddress}/track`, {}).catch(() => {});

    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL_MS);

      // Trigger re-fetch each poll to get latest on-chain state
      await apiPost(`/api/monitor/portfolio/${walletAddress}/track`, {}).catch(() => {});
      // Wait briefly for the fetch to complete
      await sleep(3_000);

      const after = await getPositionBalance(walletAddress, opportunityId);

      // Detect: new position appeared, or balance increased
      if (after !== null && (before === null || after > before)) {
        await api.sendMessage(
          chatId,
          `Transaction confirmed!\n\n${summary}\n\nYour position is now live. Check /portfolio for details.`,
        );
        return;
      }
    }

    // Timeout — silently stop. Portfolio scheduler will catch it later.
  } catch (err) {
    console.error("tx-poller error:", err);
  }
}

/** Get the deposit_usd for a specific opportunity, or null if not found. */
async function getPositionBalance(
  walletAddress: string,
  opportunityId: number,
): Promise<number | null> {
  const resp = await apiGet(`/api/monitor/portfolio/${walletAddress}/positions`);
  if (!resp || typeof resp !== "object" || "error" in resp) return null;

  const positions = (resp as Record<string, unknown>).positions as Position[] | undefined;
  if (!Array.isArray(positions)) return null;

  const match = positions.find((p) => p.opportunity_id === opportunityId);
  return match?.deposit_usd ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
