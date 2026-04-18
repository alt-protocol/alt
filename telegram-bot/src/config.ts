/** Centralized configuration for the telegram bot service. */

export const config = {
  // Backend API
  apiUrl: process.env.AKASHI_API_URL || "http://localhost:8001",

  // Frontend (for sign URLs)
  frontendUrl: process.env.AKASHI_FRONTEND_URL || "http://localhost:3000",

  // Timeouts (ms)
  apiTimeoutMs: 15_000,
  trackTimeoutMs: 10_000,
  portfolioTimeoutMs: 10_000,
  aiChatTimeoutMs: 90_000,
  memoryExtractTimeoutMs: 15_000,

  // Action confirmation expiry
  actionExpiryMs: 5 * 60 * 1000, // 5 minutes

  // Rate limits
  platformDailyMessageLimit: 50,

  // Memory
  maxMemories: 30,
  maxPromptMemories: 30,
  maxConversationMessages: 20,

  // Prompt
  maxWalletBalances: 5,

  // AI
  aiMaxSteps: 10,
  aiMaxTokens: 4096,

  // Pricing estimates ($ per million tokens)
  pricing: {
    haiku: { input: 0.8, output: 4.0 },
    sonnet: { input: 3.0, output: 15.0 },
  },

  // Validation
  base58Regex: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,

  // Telegram
  telegramMaxMessageLength: 4096,
} as const;
