import { tool } from "ai";
import { z } from "zod";
import { eq, and, sum, sql } from "drizzle-orm";
import { db } from "./db/connection.js";
import { users, userPreferences, usage } from "./db/schema.js";
import { encrypt } from "./crypto.js";
import { config } from "./config.js";
import { apiGet, apiPost } from "./api-client.js";

// ---------------------------------------------------------------------------
// Discover tools
// ---------------------------------------------------------------------------

const searchYields = tool({
  description:
    "Search Solana yield opportunities with filters. Returns APY, TVL, protocol, and token data.",
  parameters: z.object({
    category: z
      .enum(["earn", "lending", "vault", "multiply", "insurance-fund"])
      .optional()
      .describe("Filter by yield category"),
    tokens: z
      .string()
      .optional()
      .describe("Comma-separated token symbols, e.g. 'USDC,USDT'"),
    sort: z
      .enum(["apy_desc", "apy_asc", "tvl_desc", "tvl_asc"])
      .optional()
      .describe("Sort order (default: apy_desc)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Max results (default: 10, max: 50)"),
  }),
  execute: async (params) => {
    const qs = new URLSearchParams();
    if (params.category) qs.set("category", params.category);
    if (params.tokens) qs.set("tokens", params.tokens);
    qs.set("stablecoins_only", "true");
    if (params.sort) qs.set("sort", params.sort);
    if (params.limit) qs.set("limit", String(params.limit));
    const result = await apiGet(`/api/discover/yields?${qs}`);
    // Annotate for AI: make opportunity IDs unambiguous
    return {
      ...result as Record<string, unknown>,
      _instruction: "Each item has a numeric `id` field. Use that exact `id` as `opportunity_id` in build_deposit_tx / build_withdraw_tx. NEVER use the item's position in the list.",
    };
  },
});

const getYieldDetails = tool({
  description:
    "Get detailed information about a specific yield opportunity including protocol info and deposit address.",
  parameters: z.object({
    opportunity_id: z.number().int().positive().describe("The numeric `id` from search_yields results — NOT the position in the list"),
  }),
  execute: async ({ opportunity_id }) => {
    return apiGet(`/api/discover/yields/${opportunity_id}`);
  },
});

const getProtocols = tool({
  description: "List all supported DeFi protocols with audit status and descriptions.",
  parameters: z.object({}),
  execute: async () => {
    return apiGet("/api/discover/protocols");
  },
});

// ---------------------------------------------------------------------------
// Monitor tools
// ---------------------------------------------------------------------------

const getPortfolio = tool({
  description:
    "Get full portfolio: summary (ROI, APY, projected yield), all positions with PnL, idle wallet balances, and diversification. Use for any portfolio-related question.",
  parameters: z.object({
    wallet_address: z.string().describe("Solana wallet address (base58)"),
  }),
  execute: async ({ wallet_address }) => {
    // Trigger tracking and wait for background fetch to complete
    await apiPost(`/api/monitor/portfolio/${wallet_address}/track`, {}).catch(() => {});

    for (let i = 0; i < 10; i++) {
      const resp = await apiGet(`/api/monitor/portfolio/${wallet_address}/status`).catch(() => null);
      const status = (resp as Record<string, unknown> | null)?.fetch_status;
      if (status !== "fetching") break;
      await new Promise((r) => setTimeout(r, 500));
    }

    // Fetch analytics + positions in parallel, merge for AI
    const [analytics, positionsData] = await Promise.all([
      apiGet(`/api/monitor/portfolio/${wallet_address}/analytics`),
      apiGet(`/api/monitor/portfolio/${wallet_address}/positions`),
    ]);

    return {
      ...(analytics as Record<string, unknown>),
      positions: (positionsData as Record<string, unknown>)?.positions ?? [],
    };
  },
});

const getWalletBalances = tool({
  description: "Get raw SPL token balances for a Solana wallet.",
  parameters: z.object({
    wallet_address: z.string().describe("Solana wallet address (base58)"),
  }),
  execute: async ({ wallet_address }) => {
    return apiGet(`/api/monitor/portfolio/${wallet_address}`);
  },
});

const getPositionHistory = tool({
  description: "Get historical portfolio value over time (7d/30d/90d buckets).",
  parameters: z.object({
    wallet_address: z.string().describe("Solana wallet address"),
    period: z
      .enum(["7d", "30d", "90d"])
      .optional()
      .describe("Time period (default: 7d)"),
  }),
  execute: async ({ wallet_address, period }) => {
    const qs = period ? `?period=${period}` : "";
    return apiGet(`/api/monitor/portfolio/${wallet_address}/positions/history${qs}`);
  },
});

const getPositionEvents = tool({
  description:
    "Get transaction events for a wallet (deposits, withdrawals, interest earned).",
  parameters: z.object({
    wallet_address: z.string().describe("Solana wallet address"),
    protocol: z.string().optional().describe("Filter by protocol slug"),
    limit: z.number().int().optional().describe("Max events to return"),
  }),
  execute: async ({ wallet_address, protocol, limit }) => {
    const qs = new URLSearchParams();
    if (protocol) qs.set("protocol", protocol);
    if (limit) qs.set("limit", String(limit));
    const query = qs.toString() ? `?${qs}` : "";
    return apiGet(`/api/monitor/portfolio/${wallet_address}/events${query}`);
  },
});

// ---------------------------------------------------------------------------
// Manage tools (transactions)
// ---------------------------------------------------------------------------

const buildDepositTx = tool({
  description:
    "Build an unsigned deposit transaction. For multiply positions, include leverage (REQUIRED for open). The user must confirm before you call this.",
  parameters: z.object({
    opportunity_id: z.number().int().positive().describe("The numeric `id` from search_yields results — NOT the position in the list"),
    wallet_address: z.string().describe("Solana wallet address"),
    amount: z.string().describe("Amount to deposit (human-readable, e.g. '100.5')"),
    leverage: z.number().min(1.1).optional().describe("Leverage multiplier for multiply positions (e.g. 3.0). REQUIRED when opening a multiply position."),
    slippage_bps: z.number().int().min(1).max(1000).optional().describe("Slippage tolerance in basis points (default varies by protocol)"),
    action: z.enum(["open", "adjust", "add_collateral", "borrow_more"]).optional().describe("Action for multiply positions (default: open)"),
    position_id: z.string().optional().describe("Existing position ID — required for Jupiter multiply adjust/manage"),
    deposit_token: z.enum(["debt", "collateral"]).optional().describe("Which token to deposit for multiply (default: collateral)"),
  }),
  execute: async (params) => {
    const { opportunity_id, wallet_address, amount, ...extra } = params;
    const extra_data: Record<string, unknown> = {};
    if (extra.leverage != null) extra_data.leverage = extra.leverage;
    if (extra.slippage_bps != null) extra_data.slippageBps = extra.slippage_bps;
    if (extra.action && extra.action !== "open") extra_data.action = extra.action;
    if (extra.position_id) extra_data.position_id = extra.position_id;
    if (extra.deposit_token) extra_data.deposit_token = extra.deposit_token;

    return apiPost("/api/manage/tx/build-deposit", {
      opportunity_id,
      wallet_address,
      amount,
      ...(Object.keys(extra_data).length > 0 ? { extra_data } : {}),
    });
  },
});

const buildWithdrawTx = tool({
  description:
    "Build an unsigned withdrawal transaction. For multiply positions, set is_closing_position=true to close. The user must confirm before you call this.",
  parameters: z.object({
    opportunity_id: z.number().int().positive().describe("The numeric `id` from search_yields results — NOT the position in the list"),
    wallet_address: z.string().describe("Solana wallet address"),
    amount: z.string().describe("Amount to withdraw (human-readable, e.g. '100.5'). Use '0' when fully closing a multiply position."),
    slippage_bps: z.number().int().min(1).max(1000).optional().describe("Slippage tolerance in basis points (default varies by protocol)"),
    action: z.enum(["close", "adjust", "withdraw_collateral", "repay_debt"]).optional().describe("Action for multiply positions (default: close)"),
    position_id: z.string().optional().describe("Existing position ID — required for Jupiter multiply close/adjust"),
    is_closing_position: z.boolean().optional().describe("Set true to fully close a multiply position"),
  }),
  execute: async (params) => {
    const { opportunity_id, wallet_address, amount, ...extra } = params;
    const extra_data: Record<string, unknown> = {};
    if (extra.slippage_bps != null) extra_data.slippageBps = extra.slippage_bps;
    if (extra.action && extra.action !== "close") extra_data.action = extra.action;
    if (extra.position_id) extra_data.position_id = extra.position_id;
    if (extra.is_closing_position) extra_data.isClosingPosition = true;

    return apiPost("/api/manage/tx/build-withdraw", {
      opportunity_id,
      wallet_address,
      amount,
      ...(Object.keys(extra_data).length > 0 ? { extra_data } : {}),
    });
  },
});

const buildSwapTx = tool({
  description:
    "Build an unsigned Jupiter swap transaction. Returns base64 transaction for signing.",
  parameters: z.object({
    wallet_address: z.string().describe("Solana wallet address"),
    input_mint: z.string().describe("Input token mint address"),
    output_mint: z.string().describe("Output token mint address"),
    amount: z.string().describe("Amount in smallest units (lamports/micro-units)"),
    slippage_bps: z.number().int().min(1).max(500).optional().describe("Slippage in basis points (default: 50 = 0.5%)"),
  }),
  execute: async (params) => {
    return apiPost("/api/manage/tx/build-swap", params);
  },
});

const getSwapQuote = tool({
  description: "Get a Jupiter swap quote with routing, fees, and price impact.",
  parameters: z.object({
    inputMint: z.string().describe("Input token mint address"),
    outputMint: z.string().describe("Output token mint address"),
    amount: z.string().describe("Amount in smallest units"),
    taker: z.string().describe("Wallet address of the swapper"),
    slippageBps: z.number().int().optional().describe("Slippage in basis points"),
  }),
  execute: async ({ inputMint, outputMint, amount, taker, slippageBps }) => {
    const qs = new URLSearchParams({ inputMint, outputMint, amount, taker });
    if (slippageBps) qs.set("slippageBps", String(slippageBps));
    return apiGet(`/api/manage/swap/quote?${qs}`);
  },
});

const getBalance = tool({
  description: "Get the current deposited balance for a specific yield opportunity.",
  parameters: z.object({
    opportunity_id: z.number().int().positive().describe("The numeric `id` from search_yields results — NOT the position in the list"),
    wallet_address: z.string().describe("Solana wallet address"),
  }),
  execute: async (params) => {
    return apiPost("/api/manage/balance", params);
  },
});

const getWithdrawState = tool({
  description: "Check withdrawal state for a position (e.g., Drift 3-day redemption timers).",
  parameters: z.object({
    opportunity_id: z.number().int().positive().describe("The numeric `id` from search_yields results — NOT the position in the list"),
    wallet_address: z.string().describe("Solana wallet address"),
  }),
  execute: async (params) => {
    return apiPost("/api/manage/withdraw-state", params);
  },
});

// ---------------------------------------------------------------------------
// Transaction request tools (explicit schemas — AI sees every field)
// ---------------------------------------------------------------------------

const requestDeposit = tool({
  description:
    "Request a deposit/open transaction that requires user confirmation. " +
    "For multiply positions, leverage is REQUIRED.",
  parameters: z.object({
    opportunity_id: z.number().int().positive().describe("The numeric `id` from search_yields results"),
    amount: z.string().describe("Amount to deposit (human-readable, e.g. '100.5')"),
    summary: z.string().describe("Clear summary of what will happen if confirmed"),
    leverage: z.number().min(1.1).optional().describe("Leverage for multiply open/adjust (e.g. 3.0). REQUIRED for multiply."),
    slippage_bps: z.number().int().min(1).max(1000).optional().describe("Slippage in basis points"),
    action: z.enum(["open", "adjust", "add_collateral", "borrow_more"]).optional().describe("Multiply action (default: open)"),
    position_id: z.string().optional().describe("Position ID for Jupiter multiply adjust/manage"),
    deposit_token: z.enum(["debt", "collateral"]).optional().describe("Which token to deposit for multiply"),
  }),
  execute: async ({ opportunity_id, amount, summary, ...extra }) => {
    return {
      pending: true,
      action: "build_deposit_tx",
      params: { opportunity_id, amount, ...extra },
      summary,
      message: "ACTION PENDING — user must tap Confirm. Do NOT tell the user this is done or completed.",
    };
  },
});

const requestWithdraw = tool({
  description:
    "Request a withdrawal/close transaction that requires user confirmation. " +
    "For multiply close, set is_closing_position=true.",
  parameters: z.object({
    opportunity_id: z.number().int().positive().describe("The numeric `id` from search_yields results"),
    amount: z.string().describe("Amount to withdraw. Use '0' for full multiply close."),
    summary: z.string().describe("Clear summary of what will happen if confirmed"),
    slippage_bps: z.number().int().min(1).max(1000).optional().describe("Slippage in basis points"),
    action: z.enum(["close", "adjust", "withdraw_collateral", "repay_debt"]).optional().describe("Multiply action (default: close)"),
    position_id: z.string().optional().describe("Position ID for Jupiter multiply close/adjust"),
    is_closing_position: z.boolean().optional().describe("Set true to fully close a multiply position"),
  }),
  execute: async ({ opportunity_id, amount, summary, ...extra }) => {
    return {
      pending: true,
      action: "build_withdraw_tx",
      params: { opportunity_id, amount, ...extra },
      summary,
      message: "ACTION PENDING — user must tap Confirm. Do NOT tell the user this is done or completed.",
    };
  },
});

const requestSwap = tool({
  description: "Request a token swap transaction that requires user confirmation.",
  parameters: z.object({
    input_mint: z.string().describe("Input token mint address"),
    output_mint: z.string().describe("Output token mint address"),
    amount: z.string().describe("Amount in smallest units (lamports/micro-units)"),
    summary: z.string().describe("Clear summary of what will happen if confirmed"),
    slippage_bps: z.number().int().min(1).max(500).optional().describe("Slippage in basis points (default: 50)"),
  }),
  execute: async ({ summary, ...params }) => {
    return {
      pending: true,
      action: "build_swap_tx",
      params,
      summary,
      message: "ACTION PENDING — user must tap Confirm. Do NOT tell the user this is done or completed.",
    };
  },
});

// ---------------------------------------------------------------------------
// Usage tool (reads from DB directly)
// ---------------------------------------------------------------------------

const getUsage = tool({
  description:
    "Get the user's token usage and estimated costs. Call this when the user asks about costs, billing, or how much they've used.",
  parameters: z.object({
    user_id: z.number().int().describe("The user's database ID"),
  }),
  execute: async ({ user_id }) => {
    const today = new Date().toISOString().slice(0, 10);
    const [todayUsage] = await db
      .select()
      .from(usage)
      .where(and(eq(usage.user_id, user_id), eq(usage.date, today)))
      .limit(1);

    const [totals] = await db
      .select({
        total_messages: sum(usage.message_count),
        total_input: sum(usage.input_tokens),
        total_output: sum(usage.output_tokens),
      })
      .from(usage)
      .where(eq(usage.user_id, user_id));

    const todayMsgs = todayUsage?.message_count ?? 0;
    const todayInput = Number(todayUsage?.input_tokens ?? 0);
    const todayOutput = Number(todayUsage?.output_tokens ?? 0);
    const { input: pIn, output: pOut } = config.pricing.haiku;
    const todayCost = (todayInput / 1_000_000) * pIn + (todayOutput / 1_000_000) * pOut;

    const totalMsgs = Number(totals?.total_messages ?? 0);
    const totalInput = Number(totals?.total_input ?? 0);
    const totalOutput = Number(totals?.total_output ?? 0);
    const totalCost = (totalInput / 1_000_000) * pIn + (totalOutput / 1_000_000) * pOut;

    return {
      today: {
        messages: todayMsgs,
        input_tokens: todayInput,
        output_tokens: todayOutput,
        estimated_cost_usd: Number(todayCost.toFixed(4)),
      },
      all_time: {
        messages: totalMsgs,
        input_tokens: totalInput,
        output_tokens: totalOutput,
        estimated_cost_usd: Number(totalCost.toFixed(4)),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Settings tools (read + modify user config)
// ---------------------------------------------------------------------------

const getSettings = tool({
  description:
    "Get the user's current settings: AI provider, model, risk tolerance, alert thresholds, wallet, personality notes. Call this when the user asks about their settings or before suggesting changes.",
  parameters: z.object({
    user_id: z.number().int().describe("The user's database ID"),
  }),
  execute: async ({ user_id }) => {
    const [user] = await db
      .select({
        wallet_address: users.wallet_address,
        api_provider: users.api_provider,
        model_id: users.model_id,
        has_api_key: sql<boolean>`${users.api_key} IS NOT NULL`,
        ollama_url: users.ollama_url,
        soul_notes: users.soul_notes,
      })
      .from(users)
      .where(eq(users.id, user_id))
      .limit(1);

    if (!user) return { error: "User not found" };

    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.user_id, user_id))
      .limit(1);

    return {
      ai: {
        provider: user.api_provider ?? "anthropic",
        model: user.model_id ?? (user.has_api_key ? "sonnet (default)" : "haiku (free tier)"),
        has_api_key: user.has_api_key,
        ollama_url: user.ollama_url,
      },
      wallet: user.wallet_address,
      soul_notes: user.soul_notes,
      preferences: prefs
        ? {
            risk_tolerance: prefs.risk_tolerance,
            preferred_tokens: prefs.preferred_tokens,
            preferred_protocols: prefs.preferred_protocols,
            alerts_enabled: prefs.alerts_enabled,
            apy_drop_pct: prefs.apy_drop_pct,
            apy_spike_pct: prefs.apy_spike_pct,
            depeg_threshold_bps: prefs.depeg_threshold_bps,
            tvl_drop_pct: prefs.tvl_drop_pct,
            min_new_opp_apy: prefs.min_new_opp_apy,
            quiet_hours_start: prefs.quiet_hours_start,
            quiet_hours_end: prefs.quiet_hours_end,
            min_alert_interval_minutes: prefs.min_alert_interval_minutes,
          }
        : null,
    };
  },
});

const updateAiConfig = tool({
  description:
    "Update the user's AI provider configuration. Can set provider, model, API key, or Ollama URL. " +
    "IMPORTANT: Never repeat an API key in your response. If setting an API key, warn the user to delete their message.",
  parameters: z.object({
    user_id: z.number().int().describe("The user's database ID"),
    provider: z
      .enum(["anthropic", "openai", "google", "ollama", "openrouter"])
      .optional()
      .describe("AI provider to use"),
    model_id: z.string().optional().describe("Model ID (e.g. claude-sonnet-4-20250514, gpt-4o)"),
    api_key: z.string().optional().describe("API key (will be encrypted before storage)"),
    ollama_url: z.string().optional().describe("Ollama server URL (only for ollama provider)"),
  }),
  execute: async ({ user_id, provider, model_id, api_key, ollama_url }) => {
    const updates: Record<string, unknown> = {};
    if (provider !== undefined) updates.api_provider = provider;
    if (model_id !== undefined) updates.model_id = model_id;
    if (api_key !== undefined) updates.api_key = encrypt(api_key);
    if (ollama_url !== undefined) updates.ollama_url = ollama_url;

    if (Object.keys(updates).length === 0) return { error: "No fields to update" };

    const result = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, user_id))
      .returning({ id: users.id });

    if (result.length === 0) return { error: "User not found" };

    const changed = Object.keys(updates)
      .filter((k) => k !== "api_key")
      .map((k) => `${k}: ${updates[k]}`);
    if (api_key) changed.push("api_key: [saved and encrypted]");

    return {
      success: true,
      updated: changed,
      security_note: api_key
        ? "API key was encrypted and saved. Remind the user to delete their message containing the key."
        : undefined,
    };
  },
});

const updateWallet = tool({
  description:
    "Link or update the user's Solana wallet address. Validates base58 format.",
  parameters: z.object({
    user_id: z.number().int().describe("The user's database ID"),
    wallet_address: z.string().describe("Solana wallet address (base58, 32-44 characters)"),
  }),
  execute: async ({ user_id, wallet_address }) => {
    const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    if (!BASE58.test(wallet_address)) {
      return { error: "Invalid Solana address. Must be 32-44 base58 characters." };
    }

    const result = await db
      .update(users)
      .set({ wallet_address, linked_at: new Date() })
      .where(eq(users.id, user_id))
      .returning({ id: users.id });

    if (result.length === 0) return { error: "User not found" };

    return {
      success: true,
      wallet_address,
      short: `${wallet_address.slice(0, 6)}...${wallet_address.slice(-4)}`,
    };
  },
});

const updatePreferencesTool = tool({
  description:
    "Update user alert and risk preferences. All fields optional — only set what the user wants to change.",
  parameters: z.object({
    user_id: z.number().int().describe("The user's database ID"),
    risk_tolerance: z.enum(["conservative", "moderate", "aggressive"]).optional(),
    preferred_tokens: z.array(z.string()).optional().describe("Token symbols, e.g. ['USDC', 'SOL']"),
    preferred_protocols: z.array(z.string()).optional().describe("Protocol slugs, e.g. ['kamino', 'jupiter']"),
    alerts_enabled: z.boolean().optional().describe("Enable or disable all alerts"),
    apy_drop_pct: z.number().min(1).max(100).optional().describe("Alert when APY drops by this % (default: 20)"),
    apy_spike_pct: z.number().min(1).max(500).optional().describe("Alert when APY spikes by this % (default: 50)"),
    depeg_threshold_bps: z.number().min(1).max(1000).optional().describe("Depeg alert threshold in bps (default: 50)"),
    tvl_drop_pct: z.number().min(1).max(100).optional().describe("TVL drop alert threshold % (default: 30)"),
    min_new_opp_apy: z.number().min(0).max(1000).optional().describe("Min APY for new opportunity alerts (default: 10)"),
    quiet_hours_start: z.number().int().min(0).max(23).optional().describe("Quiet hours start UTC hour"),
    quiet_hours_end: z.number().int().min(0).max(23).optional().describe("Quiet hours end UTC hour"),
    min_alert_interval_minutes: z.number().int().min(5).max(1440).optional().describe("Min minutes between alerts"),
  }),
  execute: async ({ user_id, ...fields }) => {
    const updates: Record<string, unknown> = {};
    const numericFields = ["apy_drop_pct", "apy_spike_pct", "depeg_threshold_bps", "tvl_drop_pct", "min_new_opp_apy"];
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates[key] = numericFields.includes(key) ? String(value) : value;
      }
    }

    if (Object.keys(updates).length === 0) return { error: "No fields to update" };

    const result = await db
      .update(userPreferences)
      .set(updates)
      .where(eq(userPreferences.user_id, user_id))
      .returning({ id: userPreferences.id });

    if (result.length === 0) return { error: "User preferences not found" };

    return {
      success: true,
      updated: Object.entries(updates).map(([k, v]) => `${k}: ${v}`),
    };
  },
});

const updateSoul = tool({
  description:
    "Update the user's personality notes — custom instructions for how the AI should behave. " +
    "Examples: 'be more casual', 'always show APY in table format', 'speak in Spanish'. Set to empty string to clear.",
  parameters: z.object({
    user_id: z.number().int().describe("The user's database ID"),
    soul_notes: z.string().describe("Personality/behavior instructions"),
  }),
  execute: async ({ user_id, soul_notes }) => {
    const result = await db
      .update(users)
      .set({ soul_notes: soul_notes || null })
      .where(eq(users.id, user_id))
      .returning({ id: users.id });

    if (result.length === 0) return { error: "User not found" };
    return { success: true, soul_notes: soul_notes || "(cleared)" };
  },
});

// ---------------------------------------------------------------------------
// request_action — AI calls this to request a mutation (requires user confirm)
// ---------------------------------------------------------------------------

const MUTATING_ACTIONS = [
  "update_ai_config",
  "update_wallet",
  "update_preferences",
  "update_soul",
] as const;

const requestAction = tool({
  description:
    "Request a settings/wallet mutation that requires user confirmation. " +
    "For deposits/withdrawals/swaps, use request_deposit, request_withdraw, or request_swap instead. " +
    "The system auto-injects user_id — you don't need to include it.\n\n" +
    "Exact params per action:\n" +
    "- update_ai_config: {provider?, model_id?, api_key?, ollama_url?}\n" +
    "- update_wallet: {wallet_address}\n" +
    "- update_preferences: {risk_tolerance?, alerts_enabled?, apy_drop_pct?, preferred_tokens?, ...}\n" +
    "- update_soul: {soul_notes}",
  parameters: z.object({
    action: z.enum(MUTATING_ACTIONS).describe("Which settings action to perform"),
    params: z.record(z.unknown()).describe("Parameters for the action — see description for exact fields"),
    summary: z.string().describe("Clear, human-readable summary of what will happen if confirmed"),
  }),
  execute: async ({ action, params, summary }) => {
    return {
      pending: true,
      action,
      params,
      summary,
      message: "Waiting for user confirmation. Do not proceed until they tap Confirm.",
    };
  },
});

// ---------------------------------------------------------------------------
// Mutating tool dispatcher (called after user confirms)
// ---------------------------------------------------------------------------

const mutatingToolMap: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  update_ai_config: (p) => Promise.resolve(updateAiConfig.execute(p as Parameters<typeof updateAiConfig.execute>[0], {} as never)),
  update_wallet: (p) => Promise.resolve(updateWallet.execute(p as Parameters<typeof updateWallet.execute>[0], {} as never)),
  update_preferences: (p) => Promise.resolve(updatePreferencesTool.execute(p as Parameters<typeof updatePreferencesTool.execute>[0], {} as never)),
  update_soul: (p) => Promise.resolve(updateSoul.execute(p as Parameters<typeof updateSoul.execute>[0], {} as never)),
  build_deposit_tx: (p) => Promise.resolve(buildDepositTx.execute(p as Parameters<typeof buildDepositTx.execute>[0], {} as never)),
  build_withdraw_tx: (p) => Promise.resolve(buildWithdrawTx.execute(p as Parameters<typeof buildWithdrawTx.execute>[0], {} as never)),
  build_swap_tx: (p) => Promise.resolve(buildSwapTx.execute(p as Parameters<typeof buildSwapTx.execute>[0], {} as never)),
};

/** Normalize AI-generated params to match tool schemas. */
function normalizeParams(action: string, params: Record<string, unknown>): Record<string, unknown> {
  const p = { ...params };

  if (action === "update_ai_config") {
    // Fix field name: "model" → "model_id"
    if (p.model && !p.model_id) {
      p.model_id = p.model;
      delete p.model;
    }
    // Expand short model names to full IDs
    const modelMap: Record<string, string> = {
      sonnet: "claude-sonnet-4-20250514",
      haiku: "claude-haiku-4-5-20251001",
      opus: "claude-opus-4-20250514",
      "gpt4o": "gpt-4o",
      "gpt-4": "gpt-4o",
      "gpt4": "gpt-4o",
      gemini: "gemini-2.0-flash",
    };
    if (typeof p.model_id === "string") {
      const lower = p.model_id.toLowerCase();
      if (modelMap[lower]) p.model_id = modelMap[lower];
    }
  }

  // Normalize wallet field names across all actions
  if (p.wallet && !p.wallet_address) {
    p.wallet_address = p.wallet;
    delete p.wallet;
  }
  if (p.address && !p.wallet_address) {
    p.wallet_address = p.address;
    delete p.address;
  }

  // Normalize risk field
  if (p.risk && !p.risk_tolerance) {
    p.risk_tolerance = p.risk;
    delete p.risk;
  }

  // Normalize multiply params (AI might use varying names)
  if (action === "build_deposit_tx" || action === "build_withdraw_tx") {
    if (p.slippage != null && p.slippage_bps == null) {
      p.slippage_bps = p.slippage;
      delete p.slippage;
    }
    if (p.closing != null && p.is_closing_position == null) {
      p.is_closing_position = p.closing;
      delete p.closing;
    }
    if (p.close_position != null && p.is_closing_position == null) {
      p.is_closing_position = p.close_position;
      delete p.close_position;
    }
  }

  return p;
}

/** Execute a mutating tool after user confirmation. */
export async function executeMutatingTool(
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const fn = mutatingToolMap[action];
  if (!fn) return { error: `Unknown action: ${action}` };
  const normalized = normalizeParams(action, params);
  if (action.startsWith("build_")) {
    console.log(`[tx] ${action}`, JSON.stringify({
      opportunity_id: normalized.opportunity_id,
      leverage: normalized.leverage,
      action: normalized.action,
      is_closing_position: normalized.is_closing_position,
    }));
  }
  return fn(normalized);
}

// ---------------------------------------------------------------------------
// Exports: read-only tools for AI + mutating tools behind confirmation
// ---------------------------------------------------------------------------

/** Tools the AI can call freely (read-only + mutation requests). */
export const aiTools = {
  // Discover
  search_yields: searchYields,
  // Monitor
  get_portfolio: getPortfolio,
  get_position_history: getPositionHistory,
  // Manage (read-only queries)
  get_swap_quote: getSwapQuote,
  get_balance: getBalance,
  // Settings
  get_settings: getSettings,
  get_usage: getUsage,
  // Transaction requests
  request_deposit: requestDeposit,
  request_withdraw: requestWithdraw,
  request_swap: requestSwap,
  // Settings mutation gateway
  request_action: requestAction,
};
