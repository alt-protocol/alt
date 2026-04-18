import type { UserContext } from "./memory-manager.js";
import { config } from "../config.js";

interface UserInfo {
  user_id: number;
  username: string | null;
  wallet_address: string | null;
  soul_notes: string | null;
}

interface RecentAction {
  summary: string;
  timestamp: number;
}

/** Compose full system prompt from SOUL + user context. */
export function composeSystemPrompt(
  soul: string,
  user: UserInfo,
  context: UserContext,
  recentAction?: RecentAction | null,
): string {
  let prompt = soul + "\n\n";

  // Per-user personality overrides
  if (user.soul_notes) {
    prompt += `## User Personality Preferences\n${user.soul_notes}\n\n`;
  }

  // User info
  prompt += "## About This User\n";
  prompt += `User DB ID: ${user.user_id}\n`;
  prompt += `Username: ${user.username ?? "unknown"}\n`;
  if (user.wallet_address) {
    prompt += `Wallet: ${user.wallet_address}\n`;
  } else {
    prompt += "Wallet: not linked yet. Suggest they use /connect.\n";
  }

  // Long-term memories (capped)
  if (context.memories.length > 0) {
    const capped = context.memories.slice(0, config.maxPromptMemories);
    prompt += "\n## What You Remember About Them\n";
    for (const m of capped) {
      prompt += `- ${m.fact}\n`;
    }
    if (context.memories.length > config.maxPromptMemories) {
      prompt += `(${context.memories.length - config.maxPromptMemories} older memories available)\n`;
    }
  }

  // Portfolio summary (not full positions — use get_portfolio tool for details)
  const portfolio = context.portfolio as Record<string, unknown> | null;
  const summary = portfolio?.summary as Record<string, unknown> | undefined;
  const positions = (portfolio?.positions ?? []) as Array<Record<string, unknown>>;
  if (summary && positions.length > 0) {
    prompt += "\n## Portfolio Summary (live)\n";
    prompt += `${summary.position_count ?? 0} positions totaling $${summary.total_value_usd ?? "?"} | PnL: $${summary.total_pnl_usd ?? "?"}\n`;
    prompt += "Use the get_portfolio tool for full position details.\n";
  }

  // Wallet balances (top N meaningful)
  const balancesData = context.balances as Record<string, unknown> | null;
  const balances = (balancesData?.balances ?? []) as Array<Record<string, unknown>>;
  if (balances.length > 0) {
    const meaningful = balances
      .filter((b) => Number(b.amount ?? 0) > 0)
      .slice(0, config.maxWalletBalances);
    if (meaningful.length > 0) {
      prompt += "\n## Top Wallet Balances (live)\n";
      for (const b of meaningful) {
        prompt += `- ${b.symbol ?? b.mint}: ${b.amount}\n`;
      }
    }
  }

  // Dynamic rules (wallet + user_id injection only — all other rules in SOUL.md)
  prompt += "\n## Context\n";
  if (user.wallet_address) {
    prompt += `- The user's wallet address is ${user.wallet_address}. Use this automatically for portfolio/balance tools.\n`;
  }
  prompt += `- When using tools that require user_id, pass ${user.user_id}.\n`;

  // Recent action outcome (so AI knows what happened after last confirm/cancel)
  if (recentAction && Date.now() - recentAction.timestamp < 10 * 60 * 1000) {
    const agoMin = Math.round((Date.now() - recentAction.timestamp) / 60_000);
    prompt += `\n## Recent Action\nLast confirmed action (${agoMin}m ago): ${recentAction.summary}\n`;
  }

  return prompt;
}
