import { z } from "zod";

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

export const UserPositionOut = z.object({
  id: z.number(),
  wallet_address: z.string(),
  protocol_slug: z.string(),
  product_type: z.string(),
  external_id: z.string(),
  opportunity_id: z.number().nullable(),
  deposit_amount: z.number().nullable(),
  deposit_amount_usd: z.number().nullable(),
  pnl_usd: z.number().nullable(),
  pnl_pct: z.number().nullable(),
  initial_deposit_usd: z.number().nullable(),
  opened_at: z.coerce.date().nullable(),
  held_days: z.number().nullable(),
  apy: z.number().nullable(),
  apy_realized: z.number().nullable(),
  is_closed: z.boolean().nullable(),
  closed_at: z.coerce.date().nullable(),
  close_value_usd: z.number().nullable(),
  token_symbol: z.string().nullable(),
  extra_data: z.record(z.unknown()).nullable(),
  snapshot_at: z.coerce.date(),
});

export const UserPositionHistoryPoint = z.object({
  snapshot_at: z.coerce.date(),
  deposit_amount_usd: z.number().nullable(),
  pnl_usd: z.number().nullable(),
  pnl_pct: z.number().nullable(),
});

export const UserPositionEventOut = z.object({
  id: z.number(),
  wallet_address: z.string(),
  protocol_slug: z.string(),
  product_type: z.string(),
  external_id: z.string(),
  event_type: z.string(),
  amount: z.number().nullable(),
  amount_usd: z.number().nullable(),
  tx_signature: z.string().nullable(),
  event_at: z.coerce.date(),
  extra_data: z.record(z.unknown()).nullable(),
});

export const WalletStatusOut = z.object({
  wallet_address: z.string(),
  fetch_status: z.string(),
  last_fetched_at: z.coerce.date().nullable(),
});

export const PositionsSummary = z.object({
  total_value_usd: z.number(),
  total_pnl_usd: z.number(),
  position_count: z.number(),
});

// ---------------------------------------------------------------------------
// Analytics schemas
// ---------------------------------------------------------------------------

export const DistributionItem = z.object({
  label: z.string(),
  value_usd: z.number(),
  pct: z.number(),
});

export const PortfolioAnalyticsOut = z.object({
  summary: z.object({
    total_value_usd: z.number(),
    total_pnl_usd: z.number(),
    total_initial_deposit_usd: z.number(),
    roi_pct: z.number(),
    weighted_apy: z.number(),
    weighted_apy_realized: z.number(),
    projected_yield_yearly_usd: z.number(),
    position_count: z.number(),
  }),
  stablecoin: z.object({
    total_usd: z.number(),
    idle_usd: z.number(),
    allocated_usd: z.number(),
    allocation_pct: z.number(),
    apy_total: z.number(),
    apy_allocated: z.number(),
    idle_balances: z.array(z.object({
      mint: z.string(),
      symbol: z.string().nullable(),
      ui_amount: z.number(),
    })),
  }),
  diversification: z.object({
    by_protocol: z.array(DistributionItem),
    by_category: z.array(DistributionItem),
    by_token: z.array(DistributionItem),
  }),
});

// ---------------------------------------------------------------------------
// Query param schemas
// ---------------------------------------------------------------------------

export const PositionsQuery = z.object({
  protocol: z.string().optional(),
  product_type: z.string().optional(),
});

export const PositionHistoryQuery = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("7d"),
  external_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
});

export const EventsQuery = z.object({
  protocol: z.string().optional(),
  product_type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
