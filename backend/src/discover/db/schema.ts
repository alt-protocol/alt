import {
  pgSchema,
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

const discoverSchema = pgSchema("discover");

// ---------------------------------------------------------------------------
// protocols
// ---------------------------------------------------------------------------
export const protocols = discoverSchema.table("protocols", {
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
export const yieldOpportunities = discoverSchema.table(
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
    underlying_tokens: jsonb("underlying_tokens"),
    max_leverage: numeric("max_leverage", { precision: 6, scale: 2 }),
    utilization_pct: numeric("utilization_pct", { precision: 6, scale: 2 }),
    liquidity_available_usd: numeric("liquidity_available_usd", {
      precision: 20,
      scale: 2,
    }),
    is_automated: boolean("is_automated"),
    depeg: numeric("depeg", { precision: 10, scale: 6 }),
    asset_class: varchar("asset_class", { length: 20 }).default("other").notNull(),
    chain: varchar("chain", { length: 20 }).default("solana").notNull(),
    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("idx_yo_protocol_id").on(t.protocol_id),
    index("idx_yo_active_apy").on(t.is_active, t.apy_current),
    index("idx_yo_active_tvl").on(t.is_active, t.tvl_usd),
    index("idx_yo_category").on(t.category),
    index("idx_yo_asset_class").on(t.asset_class),
    index("idx_yo_chain").on(t.chain),
    index("idx_yo_liquidity").on(t.liquidity_available_usd),
    uniqueIndex("idx_yo_protocol_external").on(t.protocol_id, t.external_id),
  ],
);

// ---------------------------------------------------------------------------
// token_warnings — Jupiter Shield warnings per mint (normalized)
// ---------------------------------------------------------------------------
export const tokenWarnings = discoverSchema.table("token_warnings", {
  id: serial("id").primaryKey(),
  mint: varchar("mint", { length: 64 }).unique().notNull(),
  warnings: jsonb("warnings").notNull(), // ShieldWarning[]
  fetched_at: timestamp("fetched_at").notNull(),
  updated_at: timestamp("updated_at").defaultNow(),
});

// ---------------------------------------------------------------------------
// yield_snapshots
// ---------------------------------------------------------------------------
export const yieldSnapshots = discoverSchema.table(
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

// ---------------------------------------------------------------------------
// stablecoin_price_snapshots — raw price time-series from Jupiter Price API
// ---------------------------------------------------------------------------
export const stablecoinPriceSnapshots = discoverSchema.table(
  "stablecoin_price_snapshots",
  {
    id: serial("id").primaryKey(),
    mint: varchar("mint", { length: 64 }).notNull(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    price_usd: numeric("price_usd", { precision: 20, scale: 10 }).notNull(),
    snapshot_at: timestamp("snapshot_at").notNull(),
  },
  (t) => [
    index("idx_sps_mint_snap").on(t.mint, t.snapshot_at),
    index("idx_sps_snap_at").on(t.snapshot_at),
  ],
);

// ---------------------------------------------------------------------------
// stablecoin_peg_stats — pre-computed rolling stats (1 row per stablecoin)
// ---------------------------------------------------------------------------
export const stablecoinPegStats = discoverSchema.table(
  "stablecoin_peg_stats",
  {
    id: serial("id").primaryKey(),
    mint: varchar("mint", { length: 64 }).notNull().unique(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    price_current: numeric("price_current", { precision: 20, scale: 10 }),
    peg_type: varchar("peg_type", { length: 20 }).notNull(),
    peg_target: numeric("peg_target", { precision: 20, scale: 10 }),
    // 1-day peg metrics
    max_deviation_1d: numeric("max_deviation_1d", { precision: 10, scale: 6 }),
    min_price_1d: numeric("min_price_1d", { precision: 20, scale: 10 }),
    max_price_1d: numeric("max_price_1d", { precision: 20, scale: 10 }),
    peg_adherence_1d: numeric("peg_adherence_1d", { precision: 6, scale: 2 }),
    volatility_1d: numeric("volatility_1d", { precision: 10, scale: 6 }),
    snapshot_count_1d: integer("snapshot_count_1d").default(0),
    // 7-day peg metrics (fixed-peg only, NULL for yield-bearing)
    max_deviation_7d: numeric("max_deviation_7d", { precision: 10, scale: 6 }),
    min_price_7d: numeric("min_price_7d", { precision: 20, scale: 10 }),
    max_price_7d: numeric("max_price_7d", { precision: 20, scale: 10 }),
    peg_adherence_7d: numeric("peg_adherence_7d", { precision: 6, scale: 2 }),
    // 7-day volatility (all stables)
    volatility_7d: numeric("volatility_7d", { precision: 10, scale: 6 }),
    snapshot_count_7d: integer("snapshot_count_7d").default(0),
    // 30-day peg metrics
    max_deviation_30d: numeric("max_deviation_30d", { precision: 10, scale: 6 }),
    min_price_30d: numeric("min_price_30d", { precision: 20, scale: 10 }),
    max_price_30d: numeric("max_price_30d", { precision: 20, scale: 10 }),
    peg_adherence_30d: numeric("peg_adherence_30d", { precision: 6, scale: 2 }),
    // 30-day volatility
    volatility_30d: numeric("volatility_30d", { precision: 10, scale: 6 }),
    snapshot_count_30d: integer("snapshot_count_30d").default(0),
    // DEX liquidity from Jupiter Price API (refreshed each cycle)
    liquidity_usd: numeric("liquidity_usd", { precision: 20, scale: 2 }),
    updated_at: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    index("idx_spst_symbol").on(t.symbol),
  ],
);
