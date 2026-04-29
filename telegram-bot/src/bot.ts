import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Bot } from "grammy";

// Handler modules
import { handleStart, handleConnect, handleSettings, handleSoul, handleUsage, handleReset, handleTestAlerts } from "./handlers/commands.js";
import {
  handleSettingsProvider,
  handleSetProvider,
  handleSettingsRisk,
  handleSetRisk,
  handleAlertsToggle,
  handleSettingsModel,
  handleSettingsApiKey,
  handleConfirmAction,
  handleCancelAction,
  handleManageAlerts,
  handleAlertToggleRule,
} from "./handlers/callbacks.js";
import { handleMessage, setSoul } from "./handlers/message.js";

// ---------------------------------------------------------------------------
// Load SOUL.md — works both in dev (src/) and built (dist/)
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const soulPath = [
  join(process.cwd(), "SOUL.md"),
  join(__dirname, "..", "SOUL.md"),
  join(__dirname, "..", "..", "SOUL.md"),
].find((p) => existsSync(p));
if (!soulPath) throw new Error("SOUL.md not found");
const SOUL = readFileSync(soulPath, "utf-8");

// Provide SOUL content to the message handler
setSoul(SOUL);

// ---------------------------------------------------------------------------
// Create bot instance
// ---------------------------------------------------------------------------
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

export const bot = new Bot(token);

// Guard: ignore channel posts / anonymous admin messages (ctx.from is undefined)
bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  await next();
});

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------
bot.command("start", handleStart);
bot.command("connect", handleConnect);
bot.command("settings", handleSettings);
bot.command("soul", handleSoul);
bot.command("usage", handleUsage);
bot.command("reset", handleReset);
bot.command("test_alerts", handleTestAlerts);

// ---------------------------------------------------------------------------
// Callback query handlers (inline keyboard buttons)
// ---------------------------------------------------------------------------
bot.callbackQuery("settings:provider", handleSettingsProvider);
bot.callbackQuery(/^set:provider:(.+)$/, handleSetProvider);
bot.callbackQuery("settings:risk", handleSettingsRisk);
bot.callbackQuery(/^set:risk:(.+)$/, handleSetRisk);
bot.callbackQuery("settings:alerts_toggle", handleAlertsToggle);
bot.callbackQuery("settings:manage_alerts", handleManageAlerts);
bot.callbackQuery(/^alert:toggle:\d+:(on|off)$/, handleAlertToggleRule);
bot.callbackQuery("settings:model", handleSettingsModel);
bot.callbackQuery("settings:apikey", handleSettingsApiKey);
bot.callbackQuery("settings:back", async (ctx) => {
  await ctx.editMessageText("Use /settings to return to settings.");
  await ctx.answerCallbackQuery();
});
bot.callbackQuery("confirm_action", handleConfirmAction);
bot.callbackQuery("cancel_action", handleCancelAction);

// ---------------------------------------------------------------------------
// Default message handler — AI chat
// ---------------------------------------------------------------------------
bot.on("message:text", handleMessage);
