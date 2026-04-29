import type { Bot, Context } from "grammy";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { apiGet, apiPost } from "../api-client.js";

const DEV_MODE = !process.env.WEBHOOK_URL;

interface PendingAlert {
  id: number;
  user_id: number;
  chat_id: string;
  message_text: string;
}

interface SummaryUser {
  user_id: number;
  chat_id: string;
  wallet_address: string;
}

export interface PortfolioSummaryResponse {
  template: string;
  positions: Array<{ name: string; depositUsd: number; apy: number; pnlUsd: number; apy30dAvg: number | null }>;
  totalValueUsd: number;
  weightedApy: number;
  projectedAnnualYield: number;
  riskFlags: string[];
}

/**
 * Start all alert polling loops.
 */
export function startAlertPoller(bot: Bot<Context>) {
  startCriticalPoller(bot);
  startDailyPoller(bot);
  startWeeklyPoller(bot);
  console.log(
    DEV_MODE
      ? "[alert-poller] Started DEV MODE (critical: 60s, daily: 60s, weekly: 60s no day gate)"
      : "[alert-poller] Started (critical: 60s, daily: hourly, weekly: 6h Monday only)",
  );
}

// ---------------------------------------------------------------------------
// Loop 1: Critical alerts (every 60s)
// ---------------------------------------------------------------------------
function startCriticalPoller(bot: Bot<Context>) {
  setInterval(async () => {
    try {
      const resp = (await apiGet("/api/alerts/pending?tier=critical&limit=20")) as {
        alerts: PendingAlert[];
      };

      if (!resp.alerts || resp.alerts.length === 0) return;

      for (const alert of resp.alerts) {
        try {
          const chatId = Number(alert.chat_id);
          if (!chatId) continue;

          await bot.api.sendMessage(chatId, alert.message_text);
          await apiPost(`/api/alerts/${alert.id}/delivered`, {});
        } catch (err) {
          console.error(`[alert-poller] Failed to deliver alert ${alert.id}:`, err);
        }
      }
    } catch {
      // Silently fail — backend might be restarting
    }
  }, 60_000);
}

// ---------------------------------------------------------------------------
// Loop 2: Daily portfolio summary (once per 24h)
// ---------------------------------------------------------------------------
function startDailyPoller(bot: Bot<Context>) {
  const interval = DEV_MODE ? 60_000 : 60 * 60 * 1000;
  const lastDelivery = new Map<number, number>();

  setInterval(async () => {
    try {
      const resp = (await apiGet("/api/alerts/summary/users")) as { users: SummaryUser[] };
      if (!resp.users || resp.users.length === 0) return;

      for (const user of resp.users) {
        try {
          const chatId = Number(user.chat_id);
          if (!chatId || !user.wallet_address) continue;

          // 24h cooldown between daily summaries per user
          const lastSent = lastDelivery.get(user.user_id) ?? 0;
          if (Date.now() - lastSent < 24 * 60 * 60 * 1000) continue;

          const summary = (await apiGet(`/api/alerts/daily/${user.wallet_address}`)) as PortfolioSummaryResponse;
          if (!summary.template) continue;

          await bot.api.sendMessage(chatId, summary.template);
          lastDelivery.set(user.user_id, Date.now());
        } catch (err) {
          console.error(`[alert-poller] Daily summary failed for user ${user.user_id}:`, err);
        }
      }
    } catch {
      // Silently fail
    }
  }, interval);
}

// ---------------------------------------------------------------------------
// Loop 3: Weekly portfolio review (Monday, with AI recommendation)
// ---------------------------------------------------------------------------
function startWeeklyPoller(bot: Bot<Context>) {
  const interval = DEV_MODE ? 60_000 : 6 * 60 * 60 * 1000;
  const deliveredWallets = new Set<string>();

  setInterval(async () => {
    if (!DEV_MODE) {
      const day = new Date().getUTCDay();
      const hour = new Date().getUTCHours();
      if (day !== 1 || hour < 8 || hour > 10) return;
    }

    try {
      const resp = (await apiGet("/api/alerts/summary/users")) as { users: SummaryUser[] };
      if (!resp.users || resp.users.length === 0) return;

      for (const user of resp.users) {
        try {
          if (DEV_MODE && deliveredWallets.has(user.wallet_address)) continue;

          const chatId = Number(user.chat_id);
          if (!chatId || !user.wallet_address) continue;

          const summary = (await apiGet(`/api/alerts/weekly/${user.wallet_address}`)) as PortfolioSummaryResponse;
          if (!summary.template) continue;

          const recommendation = await generateRecommendation(summary);
          const message = recommendation
            ? `${summary.template}\n\n${recommendation}`
            : summary.template;

          await bot.api.sendMessage(chatId, message);
          if (DEV_MODE) deliveredWallets.add(user.wallet_address);
        } catch (err) {
          console.error(`[alert-poller] Weekly summary failed for user ${user.user_id}:`, err);
        }
      }
    } catch {
      // Silently fail
    }
  }, interval);
}

/** Generate 1-2 personalized recommendation sentences using Haiku. */
export async function generateRecommendation(summary: PortfolioSummaryResponse): Promise<string | null> {
  const apiKey = process.env.PLATFORM_ANTHROPIC_KEY;
  if (!apiKey || summary.positions.length === 0) return null;

  try {
    const model = createAnthropic({ apiKey })("claude-haiku-4-5-20251001");
    const positionList = summary.positions
      .map((p) => `${p.name}: $${p.depositUsd.toFixed(0)} at ${p.apy.toFixed(1)}% APY (PnL: ${p.pnlUsd >= 0 ? "+" : ""}$${p.pnlUsd.toFixed(2)})`)
      .join("\n");

    const result = await generateText({
      model,
      system:
        "You are a DeFi portfolio advisor. Given portfolio data, write 1-2 concise sentences with a specific, actionable recommendation. " +
        "Focus on risk, diversification, or yield optimization. No greetings, no disclaimers. Be direct.",
      messages: [{
        role: "user",
        content: `Portfolio: $${summary.totalValueUsd.toFixed(0)}, overall APY: ${summary.weightedApy.toFixed(1)}%\n\nPositions:\n${positionList}`,
      }],
      maxTokens: 100,
      abortSignal: AbortSignal.timeout(10_000),
    });

    return result.text.trim() || null;
  } catch (err) {
    console.error("[alert-poller] Haiku recommendation failed:", err);
    return null;
  }
}
