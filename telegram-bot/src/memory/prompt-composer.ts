import type { UserContext } from "./memory-manager.js";
import type { SessionState } from "../handlers/session.js";
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

/** Compose full system prompt from SOUL + user context + session state + conversation summary. */
export function composeSystemPrompt(
  soul: string,
  user: UserInfo,
  context: UserContext,
  recentAction?: RecentAction | null,
  conversationSummary?: string,
  session?: SessionState | null,
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
  }

  // Dynamic context
  prompt += "\n## Context\n";
  if (user.wallet_address) {
    prompt += `- The user's wallet address is ${user.wallet_address}. Use this automatically for portfolio/balance tools.\n`;
  }
  prompt += `- When using tools that require user_id, pass ${user.user_id}.\n`;

  // Recent action outcome
  if (recentAction && Date.now() - recentAction.timestamp < 10 * 60 * 1000) {
    const agoMin = Math.round((Date.now() - recentAction.timestamp) / 60_000);
    prompt += `\n## Recent Action\nLast confirmed action (${agoMin}m ago): ${recentAction.summary}\n`;
  }

  // Session state: tell AI which IDs are valid
  if (session && session.validOpportunityIds.size > 0) {
    prompt += "\n## Current Session (Verified Data)\n";
    prompt += `- Valid opportunity IDs from last search: [${[...session.validOpportunityIds].join(", ")}]\n`;
    prompt += "- ONLY use these IDs for request_deposit/request_withdraw. Call search_yields for new ones.\n";
    if (session.lastSwapQuote) {
      prompt += `- Last verified swap quote: ${session.lastSwapQuote.summary}\n`;
    }
  }

  // Conversation summary (1-liners with timestamps)
  if (conversationSummary) {
    prompt += "\n" + conversationSummary;
  }

  return prompt;
}
