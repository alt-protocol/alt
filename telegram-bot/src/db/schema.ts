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
// user_preferences — Alert thresholds + risk config
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
    // Alert thresholds (relative percentages)
    apy_drop_pct: numeric("apy_drop_pct", { precision: 6, scale: 2 }).default(
      "20",
    ),
    apy_spike_pct: numeric("apy_spike_pct", {
      precision: 6,
      scale: 2,
    }).default("50"),
    depeg_threshold_bps: numeric("depeg_threshold_bps", {
      precision: 6,
      scale: 2,
    }).default("50"),
    tvl_drop_pct: numeric("tvl_drop_pct", { precision: 6, scale: 2 }).default(
      "30",
    ),
    min_new_opp_apy: numeric("min_new_opp_apy", {
      precision: 6,
      scale: 2,
    }).default("10"),
    // Alert delivery
    alerts_enabled: boolean("alerts_enabled").default(true).notNull(),
    quiet_hours_start: integer("quiet_hours_start"), // UTC hour 0-23
    quiet_hours_end: integer("quiet_hours_end"),
    min_alert_interval_minutes: integer("min_alert_interval_minutes").default(
      60,
    ),
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
// pending_alerts — Queue written by backend alert engine, read by bot
// ---------------------------------------------------------------------------
export const pendingAlerts = telegramSchema.table(
  "pending_alerts",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    alert_type: varchar("alert_type", { length: 50 }).notNull(), // apy_drop, apy_spike, depeg, new_opportunity, position_event
    severity: varchar("severity", { length: 20 }).notNull(), // info, warning, critical
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    delivered_at: timestamp("delivered_at"),
    dismissed_at: timestamp("dismissed_at"),
  },
  (t) => [
    index("idx_tg_alerts_user_delivered").on(t.user_id, t.delivered_at),
  ],
);

// ---------------------------------------------------------------------------
// alert_cooldowns — Prevent re-alerting same condition
// ---------------------------------------------------------------------------
export const alertCooldowns = telegramSchema.table(
  "alert_cooldowns",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    alert_type: varchar("alert_type", { length: 50 }).notNull(),
    entity_key: varchar("entity_key", { length: 255 }).notNull(), // e.g. opportunity_id
    last_alerted: timestamp("last_alerted").notNull(),
  },
  (t) => [
    uniqueIndex("idx_tg_cooldowns_unique").on(
      t.user_id,
      t.alert_type,
      t.entity_key,
    ),
  ],
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
