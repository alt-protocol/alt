import { InlineKeyboard } from "grammy";
import type { Context, Filter } from "grammy";
import { eq, and, sql } from "drizzle-orm";
import type { CoreMessage } from "ai";
import { db } from "../db/connection.js";
import { users, usage } from "../db/schema.js";
import { encrypt } from "../crypto.js";
import { chat } from "../ai.js";
import { loadUserContext } from "../memory/memory-manager.js";
import { composeSystemPrompt } from "../memory/prompt-composer.js";
import { extractMemories, saveMemories } from "../memory/memory-extractor.js";
import { saveConversationTurn } from "../memory/conversation-store.js";
import { config } from "../config.js";
import {
  awaitingWallet,
  awaitingModel,
  awaitingApiKey,
  pendingActions,
  lastActionResult,
} from "./state.js";

/** The SOUL.md content — injected by bot.ts at registration time. */
let SOUL = "";

/** Called by bot.ts to provide the loaded SOUL.md content. */
export function setSoul(content: string): void {
  SOUL = content;
}

// ---------------------------------------------------------------------------
// Default message handler — AI chat with 3-layer memory
// ---------------------------------------------------------------------------
export async function handleMessage(
  ctx: Filter<Context, "message:text">,
): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  const userMessage = ctx.message.text;

  // 0a. Check if user is setting model
  if (awaitingModel.has(ctx.from!.id)) {
    awaitingModel.delete(ctx.from!.id);
    await db.update(users).set({ model_id: userMessage.trim() }).where(eq(users.telegram_id, telegramId));
    await ctx.reply(`Model set to ${userMessage.trim()}.`);
    return;
  }

  // 0b. Check if user is pasting API key
  if (awaitingApiKey.has(ctx.from!.id)) {
    awaitingApiKey.delete(ctx.from!.id);
    const encryptedKey = encrypt(userMessage.trim());
    await db.update(users).set({ api_key: encryptedKey }).where(eq(users.telegram_id, telegramId));
    try { await ctx.deleteMessage(); } catch { /* can't always delete */ }
    await ctx.reply("API key saved and encrypted. Your message was deleted for security.");
    return;
  }

  // 0c. Check if user is in /connect flow — treat message as wallet address
  if (awaitingWallet.has(ctx.from!.id)) {
    awaitingWallet.delete(ctx.from!.id);
    const address = userMessage.trim();

    if (!config.base58Regex.test(address)) {
      await ctx.reply(
        "That doesn't look like a valid Solana address. Try again with /connect",
      );
      return;
    }

    const result = await db
      .update(users)
      .set({ wallet_address: address, linked_at: new Date() })
      .where(eq(users.telegram_id, telegramId))
      .returning();

    if (result.length === 0) {
      await ctx.reply("Please run /start first.");
      return;
    }

    await ctx.reply(
      `Wallet linked: ${address.slice(0, 6)}...${address.slice(-4)}\n\n` +
        "I can now track your positions. Try asking:\n" +
        '• "What are my positions?"\n' +
        '• "What are the best USDC yields?"',
    );
    return;
  }

  // 1. Load user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.telegram_id, telegramId))
    .limit(1);

  if (!user) {
    await ctx.reply("Please run /start first to register.");
    return;
  }

  // 2. Rate limit: platform-key users get limited daily messages
  if (!user.api_key) {
    const today = new Date().toISOString().slice(0, 10);
    const [todayUsage] = await db
      .select({ message_count: usage.message_count })
      .from(usage)
      .where(and(eq(usage.user_id, user.id), eq(usage.date, today)))
      .limit(1);

    if ((todayUsage?.message_count ?? 0) >= config.platformDailyMessageLimit) {
      await ctx.reply(
        `Daily message limit reached (${config.platformDailyMessageLimit}/day on free tier).\n\n` +
          "To get unlimited messages, set your own API key:\n" +
          "/settings apikey <your-anthropic-key>",
      );
      return;
    }
  }

  // 3. Load 3-layer context (memories + history + live portfolio)
  const context = await loadUserContext(user.id, user.wallet_address);

  // 4. Compose system prompt from SOUL + context
  const systemPrompt = composeSystemPrompt(
    SOUL,
    {
      user_id: user.id,
      username: user.username,
      wallet_address: user.wallet_address,
      soul_notes: user.soul_notes,
    },
    context,
    lastActionResult.get(ctx.from!.id) ?? null,
  );

  // 5. Build message history for AI
  const history: CoreMessage[] = context.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  // 6. Send "typing" indicator
  await ctx.replyWithChatAction("typing");

  // 7. Call AI
  try {
    const result = await chat(
      systemPrompt,
      [...history, { role: "user", content: userMessage }],
      {
        api_provider: user.api_provider,
        api_key: user.api_key,
        model_id: user.model_id,
        ollama_url: user.ollama_url,
      },
    );

    // 8. Save conversation turn (with sliding window enforcement)
    await saveConversationTurn(user.id, userMessage, result.text);

    // 9. Track usage (non-blocking, Drizzle upsert)
    const today = new Date().toISOString().slice(0, 10);
    db.insert(usage)
      .values({
        user_id: user.id,
        date: today,
        message_count: 1,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
      })
      .onConflictDoUpdate({
        target: [usage.user_id, usage.date],
        set: {
          message_count: sql`${usage.message_count} + 1`,
          input_tokens: sql`${usage.input_tokens} + ${result.inputTokens}`,
          output_tokens: sql`${usage.output_tokens} + ${result.outputTokens}`,
        },
      })
      .catch((err) => console.error("Usage tracking failed:", err));

    // 10. Extract memories async (don't block the response)
    const existingFacts = context.memories.map((m) => m.fact);
    extractMemories(userMessage, result.text, existingFacts)
      .then((facts) => saveMemories(user.id, facts))
      .catch((err) => console.error("Memory save failed:", err));

    // 11. Send response — with Confirm/Cancel if a mutation was requested
    if (result.pendingAction) {
      // Auto-inject user_id and wallet_address so AI doesn't have to
      const enrichedParams = {
        ...result.pendingAction.params,
        user_id: user.id,
        ...(user.wallet_address ? { wallet_address: user.wallet_address } : {}),
      };
      pendingActions.set(ctx.from!.id, {
        ...result.pendingAction,
        params: enrichedParams,
        expiresAt: Date.now() + config.actionExpiryMs,
      });

      const keyboard = new InlineKeyboard()
        .text("Confirm", "confirm_action")
        .text("Cancel", "cancel_action");

      await ctx.reply(result.text, { reply_markup: keyboard });
    } else if (result.text.length <= config.telegramMaxMessageLength) {
      await ctx.reply(result.text);
    } else {
      const chunks = result.text.match(/[\s\S]{1,4096}/g) ?? [result.text];
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    }
  } catch (err) {
    console.error("AI chat error:", err);
    const message =
      err instanceof Error ? err.message : "Something went wrong";
    await ctx.reply(`Error: ${message}`);
  }
}
