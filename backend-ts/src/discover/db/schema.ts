import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  date,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// protocols
// ---------------------------------------------------------------------------
export const protocols = pgTable("protocols", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 50 }).unique().notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  website_url: varchar("website_url", { length: 255 }),
  logo_url: varchar("logo_url", { length: 255 }),
  audit_status: varchar("audit_status", { length: 50 }),
  auditors: text("auditors").array(),
  launched_at: date("launched_at"),
  integration: varchar("integration", { length: 20 }).default("data_only"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// yield_opportunities
// ---------------------------------------------------------------------------
export const yieldOpportunities = pgTable(
  "yield_opportunities",
  {
    id: serial("id").primaryKey(),
    protocol_id: integer("protocol_id")
      .references(() => protocols.id, { onDelete: "cascade" })
      .notNull(),
    external_id: varchar("external_id", { length: 255 }).unique(),
    name: varchar("name", { length: 200 }).notNull(),
    category: varchar("category", { length: 50 }).notNull(),
    tokens: text("tokens").array().notNull(),
    apy_current: numeric("apy_current", { precision: 10, scale: 4 }),
    apy_7d_avg: numeric("apy_7d_avg", { precision: 10, scale: 4 }),
    apy_30d_avg: numeric("apy_30d_avg", { precision: 10, scale: 4 }),
    tvl_usd: numeric("tvl_usd", { precision: 20, scale: 2 }),
    min_deposit: numeric("min_deposit", { precision: 20, scale: 6 }),
    lock_period_days: integer("lock_period_days").default(0),
    risk_tier: varchar("risk_tier", { length: 20 }),
    deposit_address: varchar("deposit_address", { length: 255 }),
    protocol_name: varchar("protocol_name", { length: 100 }),
    is_active: boolean("is_active").default(true).notNull(),
    extra_data: jsonb("extra_data"),
    max_leverage: numeric("max_leverage", { precision: 6, scale: 2 }),
    utilization_pct: numeric("utilization_pct", { precision: 6, scale: 2 }),
    liquidity_available_usd: numeric("liquidity_available_usd", {
      precision: 20,
      scale: 2,
    }),
    is_automated: boolean("is_automated"),
    depeg: numeric("depeg", { precision: 10, scale: 6 }),
    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("idx_yo_protocol_id").on(t.protocol_id),
    index("idx_yo_active_apy").on(t.is_active, t.apy_current),
    index("idx_yo_active_tvl").on(t.is_active, t.tvl_usd),
    index("idx_yo_category").on(t.category),
    uniqueIndex("idx_yo_protocol_external").on(t.protocol_id, t.external_id),
  ],
);

// ---------------------------------------------------------------------------
// yield_snapshots
// ---------------------------------------------------------------------------
export const yieldSnapshots = pgTable(
  "yield_snapshots",
  {
    id: serial("id").primaryKey(),
    opportunity_id: integer("opportunity_id")
      .references(() => yieldOpportunities.id, { onDelete: "cascade" })
      .notNull(),
    apy: numeric("apy", { precision: 10, scale: 4 }),
    tvl_usd: numeric("tvl_usd", { precision: 20, scale: 2 }),
    snapshot_at: timestamp("snapshot_at").notNull(),
    source: varchar("source", { length: 50 }),
  },
  (t) => [
    index("idx_ys_opp_snap").on(t.opportunity_id, t.snapshot_at),
    index("idx_ys_snap_at").on(t.snapshot_at),
  ],
);
