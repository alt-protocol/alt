import {
  pgSchema,
  serial,
  varchar,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const alertSchema = pgSchema("alert");

// ---------------------------------------------------------------------------
// rules — System-defined alert types with default behavior
// ---------------------------------------------------------------------------
export const rules = alertSchema.table("rules", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 50 }).unique().notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  tier: varchar("tier", { length: 20 }).notNull(), // 'critical' | 'daily' | 'weekly'
  default_threshold: numeric("default_threshold", { precision: 10, scale: 4 }),
  threshold_unit: varchar("threshold_unit", { length: 20 }), // 'percent' | 'bps' | 'usd'
  cooldown_hours: integer("cooldown_hours").notNull().default(24),
  max_deliveries: integer("max_deliveries").notNull().default(2),
  is_active: boolean("is_active").default(true).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// user_subscriptions — Per-user rule overrides (no row = use defaults)
// ---------------------------------------------------------------------------
export const userSubscriptions = alertSchema.table(
  "user_subscriptions",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id").notNull(),
    rule_id: integer("rule_id")
      .references(() => rules.id)
      .notNull(),
    enabled: boolean("enabled").notNull().default(true),
    threshold: numeric("threshold", { precision: 10, scale: 4 }),
  },
  (t) => [uniqueIndex("idx_user_sub_unique").on(t.user_id, t.rule_id)],
);

// ---------------------------------------------------------------------------
// events — Detected conditions (append-only audit log)
// ---------------------------------------------------------------------------
export const events = alertSchema.table(
  "events",
  {
    id: serial("id").primaryKey(),
    rule_id: integer("rule_id")
      .references(() => rules.id)
      .notNull(),
    entity_key: varchar("entity_key", { length: 255 }).notNull(),
    tier: varchar("tier", { length: 20 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    metadata: jsonb("metadata").default("{}"),
    detected_value: numeric("detected_value", { precision: 20, scale: 6 }),
    detected_at: timestamp("detected_at").defaultNow().notNull(),
    resolved_at: timestamp("resolved_at"),
  },
  (t) => [
    index("idx_events_entity").on(t.entity_key, t.detected_at),
    index("idx_events_unresolved").on(t.rule_id),
  ],
);

// ---------------------------------------------------------------------------
// deliveries — What was sent to whom (cooldown tracking)
// ---------------------------------------------------------------------------
export const deliveries = alertSchema.table(
  "deliveries",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id").notNull(),
    chat_id: bigint("chat_id", { mode: "bigint" }).notNull(),
    event_id: integer("event_id").references(() => events.id),
    rule_id: integer("rule_id")
      .references(() => rules.id)
      .notNull(),
    entity_key: varchar("entity_key", { length: 255 }).notNull(),
    delivery_type: varchar("delivery_type", { length: 20 }).notNull(), // 'immediate' | 'digest' | 'reminder' | 'summary'
    message_text: text("message_text").notNull(),
    delivered_at: timestamp("delivered_at"), // NULL = pending delivery
    dismissed_at: timestamp("dismissed_at"),
  },
  (t) => [
    index("idx_deliveries_cooldown").on(
      t.user_id,
      t.rule_id,
      t.entity_key,
      t.delivered_at,
    ),
  ],
);

// ---------------------------------------------------------------------------
// digest_queue — Buffer for daily digest (cleared after delivery)
// ---------------------------------------------------------------------------
export const digestQueue = alertSchema.table(
  "digest_queue",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id").notNull(),
    event_id: integer("event_id")
      .references(() => events.id)
      .notNull(),
    rule_id: integer("rule_id")
      .references(() => rules.id)
      .notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    metadata: jsonb("metadata").default("{}"),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_digest_user").on(t.user_id)],
);
