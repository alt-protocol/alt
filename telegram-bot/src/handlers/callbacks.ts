import { InlineKeyboard } from "grammy";
import type { CallbackQueryContext, Context } from "grammy";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { users, userPreferences } from "../db/schema.js";
import { executeMutatingTool } from "../tools.js";
import { InputFile } from "grammy";
import { generateSignOptions, buildExtraParams } from "../blinks.js";
import { saveConversationTurn } from "../memory/conversation-store.js";
import { config } from "../config.js";
import { pendingActions, lastActionResult, awaitingModel, awaitingApiKey } from "./state.js";
import { pollForPosition } from "../services/tx-poller.js";

/** Get the DB user ID from Telegram ID. */
async function getUserDbId(telegramId: number): Promise<number | null> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegram_id, BigInt(telegramId)))
    .limit(1);
  return user?.id ?? null;
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------
export async function handleSettingsProvider(
  ctx: CallbackQueryContext<Context>,
): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text("Anthropic (Claude)", "set:provider:anthropic")
    .text("OpenAI (GPT)", "set:provider:openai")
    .row()
    .text("Google (Gemini)", "set:provider:google")
    .text("Ollama (local)", "set:provider:ollama")
    .row()
    .text("OpenRouter", "set:provider:openrouter");
  await ctx.editMessageText("Choose your AI provider:", { reply_markup: keyboard });
  await ctx.answerCallbackQuery();
}

export async function handleSetProvider(
  ctx: CallbackQueryContext<Context>,
): Promise<void> {
  const provider = ctx.match![1];
  const telegramId = BigInt(ctx.from!.id);
  await db.update(users).set({ api_provider: provider }).where(eq(users.telegram_id, telegramId));
  await ctx.editMessageText(`Provider set to ${provider}.`);
  await ctx.answerCallbackQuery();
}

// ---------------------------------------------------------------------------
// Risk selection
// ---------------------------------------------------------------------------
export async function handleSettingsRisk(
  ctx: CallbackQueryContext<Context>,
): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text("Conservative", "set:risk:conservative")
    .text("Moderate", "set:risk:moderate")
    .text("Aggressive", "set:risk:aggressive");
  await ctx.editMessageText("Choose your risk tolerance:", { reply_markup: keyboard });
  await ctx.answerCallbackQuery();
}

export async function handleSetRisk(
  ctx: CallbackQueryContext<Context>,
): Promise<void> {
  const risk = ctx.match![1];
  const telegramId = BigInt(ctx.from!.id);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.telegram_id, telegramId)).limit(1);
  if (user) {
    await db.update(userPreferences).set({ risk_tolerance: risk }).where(eq(userPreferences.user_id, user.id));
  }
  await ctx.editMessageText(`Risk tolerance set to ${risk}.`);
  await ctx.answerCallbackQuery();
}

// ---------------------------------------------------------------------------
// Alerts toggle
// ---------------------------------------------------------------------------
export async function handleAlertsToggle(
  ctx: CallbackQueryContext<Context>,
): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.telegram_id, telegramId)).limit(1);
  if (user) {
    const [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.user_id, user.id)).limit(1);
    const newValue = !(prefs?.alerts_enabled ?? true);
    await db.update(userPreferences).set({ alerts_enabled: newValue }).where(eq(userPreferences.user_id, user.id));
    await ctx.editMessageText(`Alerts ${newValue ? "enabled" : "disabled"}.`);
  }
  await ctx.answerCallbackQuery();
}

// ---------------------------------------------------------------------------
// Model selection — ask user to type it
// ---------------------------------------------------------------------------
export async function handleSettingsModel(
  ctx: CallbackQueryContext<Context>,
): Promise<void> {
  awaitingModel.add(ctx.from!.id);
  await ctx.editMessageText("Type your model ID (e.g. claude-sonnet-4-20250514, gpt-4o, gemini-2.0-flash):");
  await ctx.answerCallbackQuery();
}

// ---------------------------------------------------------------------------
// API key — ask user to type it
// ---------------------------------------------------------------------------
export async function handleSettingsApiKey(
  ctx: CallbackQueryContext<Context>,
): Promise<void> {
  awaitingApiKey.add(ctx.from!.id);
  await ctx.editMessageText(
    "Paste your API key below.\n\n" +
      "Security: Your key is encrypted with AES-256-GCM before storage. " +
      "It's only ever sent to your chosen AI provider. Never logged or shared.\n\n" +
      "I'll delete your message immediately after saving.",
  );
  await ctx.answerCallbackQuery();
}

// ---------------------------------------------------------------------------
// Confirm / Cancel action buttons
// ---------------------------------------------------------------------------
export async function handleConfirmAction(
  ctx: CallbackQueryContext<Context>,
): Promise<void> {
  const telegramUserId = ctx.from!.id;
  const pending = pendingActions.get(telegramUserId);

  if (!pending || Date.now() > pending.expiresAt) {
    pendingActions.delete(telegramUserId);
    await ctx.editMessageText("Action expired. Please ask again.");
    await ctx.answerCallbackQuery();
    return;
  }

  pendingActions.delete(telegramUserId);
  let msg: string;

  try {
    const result = await executeMutatingTool(pending.action, pending.params);
    const r = result as Record<string, unknown>;

    if (r.error) {
      msg = `Failed: ${r.error}`;
      await ctx.editMessageText(msg);
    } else if (pending.action === "build_deposit_tx" || pending.action === "build_withdraw_tx") {
      // Generate all signing formats
      const txAction = pending.action === "build_deposit_tx" ? "deposit" as const : "withdraw" as const;
      const extraParams = buildExtraParams(pending.params);
      const signOpts = await generateSignOptions(
        txAction,
        pending.params.opportunity_id as number,
        pending.params.amount as string,
        pending.params.wallet_address as string,
        extraParams,
      );

      msg = `${pending.summary}\n\nSign with your preferred method:`;

      // Edit the confirm message to show status
      await ctx.editMessageText(msg);

      if (signOpts.web.startsWith("https://")) {
        // Production: inline keyboard with web link; deeplink is encoded in QR
        const keyboard = new InlineKeyboard()
          .url("Sign in Browser", signOpts.web);

        await ctx.replyWithPhoto(new InputFile(signOpts.qr, "sign-qr.png"), {
          caption: "Scan QR with your Solana wallet app, or tap the button below:",
          reply_markup: keyboard,
        });
      } else {
        // Local dev: Telegram rejects non-HTTPS URLs in inline buttons — send QR + text links
        await ctx.replyWithPhoto(new InputFile(signOpts.qr, "sign-qr.png"), {
          caption: "Scan QR with your Solana wallet app, or use a link below:",
        });
        await ctx.reply(`Browser: ${signOpts.web}\n\nDeeplink: ${signOpts.deeplink}`);
      }

      // Start background polling to detect when user signs the tx
      pollForPosition(
        ctx.api,
        ctx.chat!.id,
        pending.params.wallet_address as string,
        pending.params.opportunity_id as number,
        pending.summary,
      );
    } else {
      msg = `Done. ${pending.summary}`;
      await ctx.editMessageText(msg);
    }
  } catch (err) {
    msg = `Error: ${err instanceof Error ? err.message : "Action failed"}`;
    await ctx.editMessageText(msg);
  }

  // Save outcome to conversation history so AI knows next turn
  const dbId = await getUserDbId(telegramUserId);
  if (dbId) {
    await saveConversationTurn(dbId, "[User confirmed action]", msg).catch(
      (err) => console.error("Failed to save action outcome:", err),
    );
    // Track last action for system prompt context
    lastActionResult.set(telegramUserId, {
      summary: msg,
      timestamp: Date.now(),
    });
  }

  await ctx.answerCallbackQuery();
}

export async function handleCancelAction(
  ctx: CallbackQueryContext<Context>,
): Promise<void> {
  const telegramUserId = ctx.from!.id;
  pendingActions.delete(telegramUserId);
  await ctx.editMessageText("Action cancelled.");

  // Save cancellation to conversation history
  const dbId = await getUserDbId(telegramUserId);
  if (dbId) {
    await saveConversationTurn(dbId, "[User cancelled action]", "Action cancelled.").catch(
      (err) => console.error("Failed to save cancellation:", err),
    );
  }

  await ctx.answerCallbackQuery();
}
