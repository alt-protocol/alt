import { InlineKeyboard } from "grammy";
import type { CommandContext, Context } from "grammy";
import { eq, and, sql, sum } from "drizzle-orm";
import { db } from "../db/connection.js";
import { users, userPreferences, usage, userMemories, conversations } from "../db/schema.js";
import { encrypt } from "../crypto.js";
import { config } from "../config.js";
import { awaitingWallet } from "./state.js";

// ---------------------------------------------------------------------------
// /start — Register user
// ---------------------------------------------------------------------------
export async function handleStart(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  const chatId = BigInt(ctx.chat.id);
  const username = ctx.from!.username ?? null;

  // Upsert user
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.telegram_id, telegramId))
    .limit(1);

  if (existing.length === 0) {
    const inserted = await db
      .insert(users)
      .values({ telegram_id: telegramId, chat_id: chatId, username })
      .onConflictDoNothing({ target: users.telegram_id })
      .returning();

    // Race condition: another concurrent /start may have inserted first
    if (inserted.length === 0) {
      await ctx.reply("Welcome back! Use /connect <address> to link your wallet.");
      return;
    }

    // Create default preferences
    await db.insert(userPreferences).values({ user_id: inserted[0].id });

    awaitingWallet.add(ctx.from!.id);
    await ctx.reply(
      "Hey! I'm Akashi, your Solana DeFi advisor.\n\n" +
        "Paste your Solana wallet address to get started.\n\n" +
        "Or ask me anything — I can help without a wallet too.",
    );
  } else {
    // Update chat_id and username in case they changed
    await db
      .update(users)
      .set({ chat_id: chatId, username })
      .where(eq(users.telegram_id, telegramId));

    if (existing[0].wallet_address) {
      await ctx.reply(`Welcome back! Tracking wallet ${existing[0].wallet_address.slice(0, 6)}...${existing[0].wallet_address.slice(-4)}. Ask me anything.`);
    } else {
      awaitingWallet.add(ctx.from!.id);
      await ctx.reply("Welcome back! Paste your wallet address to get started, or ask me anything.");
    }
  }
}

// ---------------------------------------------------------------------------
// /connect <wallet> — Link Solana wallet
// ---------------------------------------------------------------------------
export async function handleConnect(ctx: CommandContext<Context>): Promise<void> {
  const address = ctx.match?.trim();

  if (!address) {
    awaitingWallet.add(ctx.from!.id);
    await ctx.reply("What's your Solana wallet address? Paste it here.");
    return;
  }

  if (!config.base58Regex.test(address)) {
    await ctx.reply(
      "That doesn't look like a valid Solana address. It should be 32-44 base58 characters.",
    );
    return;
  }

  const telegramId = BigInt(ctx.from!.id);
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
      "I can now track your positions. Try:\n" +
      '• "What are my positions?"\n' +
      '• "What are the best USDC yields?"',
  );
}

// ---------------------------------------------------------------------------
// /settings — Show/update preferences
// ---------------------------------------------------------------------------
export async function handleSettings(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  const args = ctx.match?.trim();

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.telegram_id, telegramId))
    .limit(1);

  if (!user) {
    await ctx.reply("Please run /start first.");
    return;
  }

  // Get preferences
  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.user_id, user.id))
    .limit(1);

  // No args — show current settings with inline buttons
  if (!args) {
    const isBYOK = !!user.api_key;
    const providerDisplay = user.api_provider ?? "anthropic";
    const modelDisplay = user.model_id ?? (isBYOK ? "sonnet (default)" : "haiku (free tier)");
    const alertsDisplay = prefs?.alerts_enabled ? "on" : "off";
    const tierDisplay = isBYOK
      ? `BYOK (your ${providerDisplay} key, unlimited)`
      : `Free tier (Haiku, ${config.platformDailyMessageLimit} msgs/day)`;

    const keyboard = new InlineKeyboard()
      .text("Change Provider", "settings:provider")
      .text("Change Model", "settings:model")
      .row()
      .text(`Risk: ${prefs?.risk_tolerance ?? "moderate"}`, "settings:risk")
      .text(`Alerts: ${alertsDisplay}`, `settings:alerts_toggle`)
      .row()
      .text("Manage Alert Rules", "settings:manage_alerts")
      .text("Set API Key", "settings:apikey");

    const walletShort = user.wallet_address
      ? `${user.wallet_address.slice(0, 6)}...${user.wallet_address.slice(-4)}`
      : "not linked";

    await ctx.reply(
      `<b>Settings</b>\n\n` +
        `Plan: <code>${tierDisplay}</code>\n` +
        `Wallet: <code>${walletShort}</code>\n` +
        `Provider: <code>${providerDisplay}</code>\n` +
        `Model: <code>${modelDisplay}</code>\n` +
        `Risk: <code>${prefs?.risk_tolerance ?? "moderate"}</code>\n` +
        `Alerts: <code>${alertsDisplay}</code>\n` +
        `Digest: <code>${prefs?.digest_hour_utc ?? 9}:00 UTC</code>\n` +
        `Weekly summary: <code>${prefs?.weekly_summary_enabled !== false ? "on" : "off"}</code>`,
      { reply_markup: keyboard, parse_mode: "HTML" },
    );
    return;
  }

  // Parse setting command
  const [key, ...valueParts] = args.split(" ");
  const value = valueParts.join(" ");

  switch (key) {
    case "provider":
      if (
        !["anthropic", "openai", "google", "ollama", "openrouter"].includes(
          value,
        )
      ) {
        await ctx.reply(
          "Valid providers: anthropic, openai, google, ollama, openrouter",
        );
        return;
      }
      await db
        .update(users)
        .set({ api_provider: value })
        .where(eq(users.id, user.id));
      await ctx.reply(`Provider set to ${value}.`);
      break;

    case "model":
      if (!value) {
        await ctx.reply("Usage: /settings model <model-id>");
        return;
      }
      await db
        .update(users)
        .set({ model_id: value })
        .where(eq(users.id, user.id));
      await ctx.reply(`Model set to ${value}.`);
      break;

    case "apikey": {
      if (!value) {
        await ctx.reply("Usage: /settings apikey <your-api-key>");
        return;
      }
      // Encrypt key before storing
      const encryptedKey = encrypt(value);
      await db
        .update(users)
        .set({ api_key: encryptedKey })
        .where(eq(users.id, user.id));
      // Try to delete the message containing the key for security
      try {
        await ctx.deleteMessage();
      } catch {
        // Can't delete in private chats without admin rights — that's OK
      }
      await ctx.reply("API key saved. Your previous message was deleted for security.");
      break;
    }

    case "risk":
      if (!["conservative", "moderate", "aggressive"].includes(value)) {
        await ctx.reply("Valid risk levels: conservative, moderate, aggressive");
        return;
      }
      await db
        .update(userPreferences)
        .set({ risk_tolerance: value })
        .where(eq(userPreferences.user_id, user.id));
      await ctx.reply(`Risk tolerance set to ${value}.`);
      break;

    case "alerts":
      if (!["on", "off"].includes(value)) {
        await ctx.reply("Usage: /settings alerts <on|off>");
        return;
      }
      await db
        .update(userPreferences)
        .set({ alerts_enabled: value === "on" })
        .where(eq(userPreferences.user_id, user.id));
      await ctx.reply(`Alerts ${value === "on" ? "enabled" : "disabled"}.`);
      break;

    default:
      await ctx.reply(
        "Unknown setting. Available: provider, model, apikey, risk, alerts",
      );
  }
}

// ---------------------------------------------------------------------------
// /soul — View/set personality notes
// ---------------------------------------------------------------------------
export async function handleSoul(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  const notes = ctx.match?.trim();

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.telegram_id, telegramId))
    .limit(1);

  if (!user) {
    await ctx.reply("Please run /start first.");
    return;
  }

  if (!notes) {
    // Show current soul notes
    await ctx.reply(
      user.soul_notes
        ? `Your personality notes:\n\n${user.soul_notes}\n\nUpdate with /soul <your notes>`
        : "No personality notes set. Add them with:\n/soul be more casual and use emoji",
    );
    return;
  }

  await db
    .update(users)
    .set({ soul_notes: notes })
    .where(eq(users.id, user.id));

  await ctx.reply(`Personality notes updated: "${notes}"`);
}

// ---------------------------------------------------------------------------
// /usage — Show token consumption and costs
// ---------------------------------------------------------------------------
export async function handleUsage(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.telegram_id, telegramId))
    .limit(1);

  if (!user) {
    await ctx.reply("Please run /start first.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const [todayUsage] = await db
    .select()
    .from(usage)
    .where(and(eq(usage.user_id, user.id), eq(usage.date, today)))
    .limit(1);

  // All-time totals
  const [totals] = await db
    .select({
      total_messages: sum(usage.message_count),
      total_input: sum(usage.input_tokens),
      total_output: sum(usage.output_tokens),
    })
    .from(usage)
    .where(eq(usage.user_id, user.id));

  const msgs = todayUsage?.message_count ?? 0;
  const inputT = todayUsage?.input_tokens ?? 0;
  const outputT = todayUsage?.output_tokens ?? 0;
  const isBYOK = !!user.api_key;

  // Rough cost estimates (Sonnet: $3/$15 per MTok, Haiku: $0.80/$4 per MTok)
  const pricing = isBYOK ? config.pricing.sonnet : config.pricing.haiku;
  const todayCost =
    (Number(inputT) / 1_000_000) * pricing.input +
    (Number(outputT) / 1_000_000) * pricing.output;

  const totalMsgs = Number(totals?.total_messages ?? 0);
  const totalInput = Number(totals?.total_input ?? 0);
  const totalOutput = Number(totals?.total_output ?? 0);
  const totalCost =
    (totalInput / 1_000_000) * pricing.input +
    (totalOutput / 1_000_000) * pricing.output;

  const msgLimit = isBYOK ? "" : ` / ${config.platformDailyMessageLimit}`;
  const plan = isBYOK
    ? `BYOK (${user.api_provider ?? "anthropic"}, unlimited)`
    : `Free tier (Haiku, ${config.platformDailyMessageLimit} msgs/day)`;

  await ctx.reply(
    `<b>Usage</b>\n\n` +
      `<b>Today</b>\n` +
      `Messages: <code>${msgs}${msgLimit}</code>\n` +
      `Tokens: <code>${Number(inputT).toLocaleString()}</code> in / <code>${Number(outputT).toLocaleString()}</code> out\n` +
      `Est. cost: <code>$${todayCost.toFixed(4)}</code>\n\n` +
      `<b>All time</b>\n` +
      `Messages: <code>${totalMsgs}</code>\n` +
      `Tokens: <code>${totalInput.toLocaleString()}</code> in / <code>${totalOutput.toLocaleString()}</code> out\n` +
      `Est. cost: <code>$${totalCost.toFixed(4)}</code>\n\n` +
      `Plan: <code>${plan}</code>`,
    { parse_mode: "HTML" },
  );
}

// ---------------------------------------------------------------------------
// /reset — Clear all user data (for testing)
// ---------------------------------------------------------------------------
export async function handleReset(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.telegram_id, telegramId))
    .limit(1);

  if (!user) {
    await ctx.reply("Not registered. Run /start first.");
    return;
  }

  await Promise.all([
    db.delete(conversations).where(eq(conversations.user_id, user.id)),
    db.delete(userMemories).where(eq(userMemories.user_id, user.id)),
    db.delete(userPreferences).where(eq(userPreferences.user_id, user.id)),
    db.delete(usage).where(eq(usage.user_id, user.id)),
    db.update(users).set({ soul_notes: null }).where(eq(users.id, user.id)),
  ]);

  await ctx.reply("All data cleared. I'm treating you as a new user now. Wallet and API key are preserved.");
}
