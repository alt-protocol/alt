import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// tracked_wallets
// ---------------------------------------------------------------------------
export const trackedWallets = pgTable(
  "tracked_wallets",
  {
    id: serial("id").primaryKey(),
    wallet_address: varchar("wallet_address", { length: 255 }).unique().notNull(),
    first_seen_at: timestamp("first_seen_at").defaultNow().notNull(),
    last_fetched_at: timestamp("last_fetched_at"),
    is_active: boolean("is_active").default(true).notNull(),
    fetch_status: varchar("fetch_status", { length: 20 }).default("pending").notNull(),
  },
  (t) => [index("idx_tw_wallet").on(t.wallet_address)],
);

// ---------------------------------------------------------------------------
// user_positions
// ---------------------------------------------------------------------------
export const userPositions = pgTable(
  "user_positions",
  {
    id: serial("id").primaryKey(),
    wallet_address: varchar("wallet_address", { length: 255 }).notNull(),
    protocol_slug: varchar("protocol_slug", { length: 50 }).notNull(),
    product_type: varchar("product_type", { length: 50 }).notNull(),
    external_id: varchar("external_id", { length: 255 }).notNull(),
    opportunity_id: integer("opportunity_id"),
    deposit_amount: numeric("deposit_amount", { precision: 30, scale: 10 }),
    deposit_amount_usd: numeric("deposit_amount_usd", { precision: 20, scale: 2 }),
    pnl_usd: numeric("pnl_usd", { precision: 20, scale: 2 }),
    pnl_pct: numeric("pnl_pct", { precision: 10, scale: 4 }),
    initial_deposit_usd: numeric("initial_deposit_usd", { precision: 20, scale: 2 }),
    opened_at: timestamp("opened_at"),
    held_days: numeric("held_days", { precision: 10, scale: 4 }),
    apy: numeric("apy", { precision: 10, scale: 4 }),
    apy_realized: numeric("apy_realized", { precision: 10, scale: 4 }),
    is_closed: boolean("is_closed"),
    closed_at: timestamp("closed_at"),
    close_value_usd: numeric("close_value_usd", { precision: 20, scale: 2 }),
    token_symbol: varchar("token_symbol", { length: 50 }),
    extra_data: jsonb("extra_data"),
    snapshot_at: timestamp("snapshot_at").notNull(),
    created_at: timestamp("created_at").defaultNow(),
  },
  (t) => [
    index("idx_up_wallet_snap").on(t.wallet_address, t.snapshot_at),
    index("idx_up_wallet_ext").on(t.wallet_address, t.external_id),
    index("idx_up_wallet_proto").on(t.wallet_address, t.protocol_slug),
  ],
);

// ---------------------------------------------------------------------------
// user_position_events
// ---------------------------------------------------------------------------
export const userPositionEvents = pgTable(
  "user_position_events",
  {
    id: serial("id").primaryKey(),
    wallet_address: varchar("wallet_address", { length: 255 }).notNull(),
    protocol_slug: varchar("protocol_slug", { length: 50 }).notNull(),
    product_type: varchar("product_type", { length: 50 }).notNull(),
    external_id: varchar("external_id", { length: 255 }).notNull(),
    event_type: varchar("event_type", { length: 50 }).notNull(),
    amount: numeric("amount", { precision: 30, scale: 10 }),
    amount_usd: numeric("amount_usd", { precision: 20, scale: 2 }),
    tx_signature: varchar("tx_signature", { length: 255 }).unique(),
    event_at: timestamp("event_at").notNull(),
    extra_data: jsonb("extra_data"),
  },
  (t) => [index("idx_upe_wallet").on(t.wallet_address)],
);
