import { z } from "zod";

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

export const ProtocolOut = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  website_url: z.string().nullable(),
  logo_url: z.string().nullable(),
  audit_status: z.string().nullable(),
  auditors: z.array(z.string()).nullable(),
  integration: z.string().nullable(),
});

export const YieldHistoryPoint = z.object({
  snapshot_at: z.coerce.date(),
  apy: z.number().nullable(),
  tvl_usd: z.number().nullable(),
});

export const YieldOpportunityListOut = z.object({
  id: z.number(),
  protocol_id: z.number(),
  external_id: z.string().nullable(),
  name: z.string(),
  category: z.string(),
  tokens: z.array(z.string()),
  apy_current: z.number().nullable(),
  apy_7d_avg: z.number().nullable(),
  apy_30d_avg: z.number().nullable(),
  tvl_usd: z.number().nullable(),
  min_deposit: z.number().nullable(),
  lock_period_days: z.number(),
  risk_tier: z.string().nullable(),
  protocol_name: z.string().nullable(),
  is_active: z.boolean(),
  max_leverage: z.number().nullable(),
  utilization_pct: z.number().nullable(),
  liquidity_available_usd: z.number().nullable(),
  is_automated: z.boolean().nullable(),
  depeg: z.number().nullable(),
  protocol_url: z.string().nullable(),
  updated_at: z.coerce.date().nullable(),
});

export const YieldOpportunityDetailOut = YieldOpportunityListOut.extend({
  extra_data: z.record(z.unknown()).nullable(),
  deposit_address: z.string().nullable(),
  protocol: ProtocolOut.nullable(),
  recent_snapshots: z.array(YieldHistoryPoint),
});

// ---------------------------------------------------------------------------
// Query param schemas
// ---------------------------------------------------------------------------

export const YieldsQuery = z.object({
  category: z.string().optional(),
  sort: z
    .enum(["apy_desc", "apy_asc", "tvl_desc", "tvl_asc"])
    .default("apy_desc"),
  tokens: z.string().optional(),
  vault_tag: z.string().optional(),
  asset_class: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  protocol: z.string().optional(),
  token_type: z.string().optional(),
  apy_min: z.coerce.number().optional(),
  apy_max: z.coerce.number().optional(),
  tvl_min: z.coerce.number().optional(),
  tvl_max: z.coerce.number().optional(),
  liquidity_min: z.coerce.number().optional(),
  liquidity_max: z.coerce.number().optional(),
});

export const YieldHistoryQuery = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("7d"),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
});
