import {
  pgSchema,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  bigint,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const telegramSchema = pgSchema("telegram");

// ---------------------------------------------------------------------------
// users — Telegram user <-> Solana wallet mapping + BYOK config
// ---------------------------------------------------------------------------
export const users = telegramSchema.table(
  "users",
  {
    id: serial("id").primaryKey(),
    telegram_id: bigint("telegram_id", { mode: "bigint" }).unique().notNull(),
    chat_id: bigint("chat_id", { mode: "bigint" }).notNull(),
    username: varchar("username", { length: 100 }),
    wallet_address: varchar("wallet_address", { length: 255 }),
    linked_at: timestamp("linked_at"),
    // BYOK provider config
    api_provider: varchar("api_provider", { length: 20 }).default("anthropic"),
    api_key: text("api_key"), // encrypted at rest (AES-256-GCM)
    model_id: varchar("model_id", { length: 100 }),
    ollama_url: varchar("ollama_url", { length: 255 }),
    // Per-user personality overrides
    soul_notes: text("soul_notes"),
    is_active: boolean("is_active").default(true).notNull(),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_tg_users_telegram_id").on(t.telegram_id)],
);

// ---------------------------------------------------------------------------
// user_preferences — Risk config + alert delivery settings
// ---------------------------------------------------------------------------
export const userPreferences = telegramSchema.table(
  "user_preferences",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .unique()
      .notNull(),
    risk_tolerance: varchar("risk_tolerance", { length: 20 }).default(
      "moderate",
    ),
    preferred_tokens: text("preferred_tokens").array(),
    preferred_protocols: text("preferred_protocols").array(),
    // Alert delivery settings (thresholds moved to alert.user_subscriptions)
    alerts_enabled: boolean("alerts_enabled").default(true).notNull(),
    quiet_hours_start: integer("quiet_hours_start"), // UTC hour 0-23
    quiet_hours_end: integer("quiet_hours_end"),
    digest_hour_utc: integer("digest_hour_utc").default(9), // when to send daily digest
    weekly_summary_enabled: boolean("weekly_summary_enabled").default(true),
  },
);

// ---------------------------------------------------------------------------
// user_memories — Long-term facts (OpenClaw MEMORY.md equivalent)
// ---------------------------------------------------------------------------
export const userMemories = telegramSchema.table(
  "user_memories",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    fact: text("fact").notNull(),
    category: varchar("category", { length: 50 }).notNull(), // preference, decision, strategy, context, portfolio_note
    source: varchar("source", { length: 20 }).default("auto").notNull(), // auto | explicit
    created_at: timestamp("created_at").defaultNow().notNull(),
    expires_at: timestamp("expires_at"),
    is_active: boolean("is_active").default(true).notNull(),
  },
  (t) => [index("idx_tg_memories_user_active").on(t.user_id, t.is_active)],
);

// ---------------------------------------------------------------------------
// conversations — Recent message history (sliding window)
// ---------------------------------------------------------------------------
export const conversations = telegramSchema.table(
  "conversations",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: varchar("role", { length: 20 }).notNull(), // user, assistant, tool_use, tool_result
    content: text("content").notNull(),
    tool_name: varchar("tool_name", { length: 100 }),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_tg_conv_user_created").on(t.user_id, t.created_at)],
);

// ---------------------------------------------------------------------------
// usage — Per-user token metering (for platform key users)
// ---------------------------------------------------------------------------
export const usage = telegramSchema.table(
  "usage",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    date: date("date").notNull(),
    message_count: integer("message_count").default(0),
    input_tokens: integer("input_tokens").default(0),
    output_tokens: integer("output_tokens").default(0),
  },
  (t) => [uniqueIndex("idx_tg_usage_user_date").on(t.user_id, t.date)],
);
