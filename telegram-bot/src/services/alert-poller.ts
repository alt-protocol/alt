import type { Bot, Context } from "grammy";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { apiGet, apiPost } from "../api-client.js";

interface PendingAlert {
  id: number;
  user_id: number;
  chat_id: string;
  message_text: string;
}

interface DigestReadyUser {
  user_id: number;
  chat_id: string;
  item_count: number;
}

interface DigestResponse {
  grouped: Record<string, Array<{ title: string; body: string }>>;
  total: number;
}

/**
 * Start all alert polling loops.
 */
export function startAlertPoller(bot: Bot<Context>) {
  startCriticalPoller(bot);
  startDigestPoller(bot);
  startWeeklyPoller(bot);
  console.log("[alert-poller] Started (critical: 60s, digest: hourly, weekly: daily check)");
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
// Loop 2: Daily digest (check every hour)
// ---------------------------------------------------------------------------
function startDigestPoller(bot: Bot<Context>) {
  setInterval(async () => {
    try {
      const resp = (await apiGet("/api/alerts/digest-ready")) as {
        users: DigestReadyUser[];
      };

      if (!resp.users || resp.users.length === 0) return;

      for (const user of resp.users) {
        try {
          const chatId = Number(user.chat_id);
          if (!chatId) continue;

          // Fetch digest items
          const digest = (await apiGet(`/api/alerts/digest/${user.user_id}`)) as DigestResponse;
          if (digest.total === 0) continue;

          // Format digest message
          const message = formatDigest(digest);

          await bot.api.sendMessage(chatId, message);
          await apiPost(`/api/alerts/digest/${user.user_id}/delivered`, {});
        } catch (err) {
          console.error(`[alert-poller] Failed to deliver digest for user ${user.user_id}:`, err);
        }
      }
    } catch {
      // Silently fail
    }
  }, 60 * 60 * 1000); // Every hour
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Loop 3: Weekly summary (check daily, deliver on Monday)
// ---------------------------------------------------------------------------

interface WeeklyUser {
  user_id: number;
  chat_id: string;
  wallet_address: string;
}

interface WeeklySummaryResponse {
  template: string;
  positions: Array<{ name: string; depositUsd: number; apy: number; pnlUsd: number }>;
  totalValueUsd: number;
  weightedApy: number;
  projectedAnnualYield: number;
}

function startWeeklyPoller(bot: Bot<Context>) {
  // Check every 6 hours. Only runs on Monday.
  setInterval(async () => {
    const day = new Date().getUTCDay();
    const hour = new Date().getUTCHours();
    // Monday = 1, deliver around 9 UTC
    if (day !== 1 || hour < 8 || hour > 10) return;

    try {
      const resp = (await apiGet("/api/alerts/weekly/users")) as { users: WeeklyUser[] };
      if (!resp.users || resp.users.length === 0) return;

      for (const user of resp.users) {
        try {
          const chatId = Number(user.chat_id);
          if (!chatId) continue;

          const summary = (await apiGet(`/api/alerts/weekly/${user.wallet_address}`)) as WeeklySummaryResponse;
          if (!summary.template) continue;

          // Generate Haiku recommendation from structured data
          const recommendation = await generateRecommendation(summary);
          const message = recommendation
            ? `${summary.template}\n\n${recommendation}`
            : summary.template;

          await bot.api.sendMessage(chatId, message);
        } catch (err) {
          console.error(`[alert-poller] Weekly summary failed for user ${user.user_id}:`, err);
        }
      }
    } catch {
      // Silently fail
    }
  }, 6 * 60 * 60 * 1000); // Every 6 hours
}

/** Generate 1-2 personalized recommendation sentences using Haiku. */
async function generateRecommendation(summary: WeeklySummaryResponse): Promise<string | null> {
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

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatDigest(digest: DigestResponse): string {
  const lines: string[] = ["Your daily DeFi update:"];

  for (const [category, items] of Object.entries(digest.grouped)) {
    lines.push("");
    lines.push(category);
    for (const item of items) {
      lines.push(`- ${item.body}`);
    }
  }

  if (digest.total === 0) {
    lines.push("");
    lines.push("No notable changes today.");
  }

  return lines.join("\n");
}
