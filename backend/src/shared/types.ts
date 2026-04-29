export interface PegStabilityData {
  symbol: string;
  price_current: number | null;
  peg_type: string;
  peg_target: number | null;
  // Fixed-peg only (null for yield-bearing)
  peg_adherence_7d: number | null;
  max_deviation_7d: number | null;
  peg_adherence_30d: number | null;
  max_deviation_30d: number | null;
  // 1d
  min_price_1d: number | null;
  max_price_1d: number | null;
  snapshot_count_1d: number;
  // All stables
  volatility_7d: number | null;
  volatility_30d: number | null;
  min_price_7d: number | null;
  max_price_7d: number | null;
  min_price_30d: number | null;
  max_price_30d: number | null;
  snapshot_count_7d: number;
  snapshot_count_30d: number;
  // DEX liquidity (from Jupiter Price API)
  liquidity_usd: number | null;
}

export interface OpportunityDetail {
  id: number;
  protocol_id: number;
  external_id: string | null;
  name: string;
  category: string;
  tokens: string[];
  apy_current: number | null;
  tvl_usd: number | null;
  deposit_address: string | null;
  max_leverage: number | null;
  extra_data: Record<string, unknown> | null;
  protocol: {
    id: number;
    slug: string;
    name: string;
  } | null;
}

export interface OpportunityMapEntry {
  id: number;
  apy_current: number | null;
  tvl_usd: number | null;
  first_token: string | null;
  extra_data: Record<string, unknown> | null;
}

export interface ShieldWarning {
  type: string;
  message: string;
  severity: "info" | "warning";
}

export interface SearchYieldsParams {
  category?: string;
  tokens?: string;
  vault_tag?: string;
  asset_class?: string;
  sort?: "apy_desc" | "apy_asc" | "tvl_desc" | "tvl_asc";
  limit?: number;
  offset?: number;
  protocol?: string;
  token_type?: string;
  apy_min?: number;
  apy_max?: number;
  tvl_min?: number;
  tvl_max?: number;
  liquidity_min?: number;
  liquidity_max?: number;
}

export interface YieldListItem {
  id: number;
  protocol_id: number;
  external_id: string | null;
  name: string;
  category: string;
  tokens: string[];
  apy_current: number | null;
  apy_7d_avg: number | null;
  apy_30d_avg: number | null;
  tvl_usd: number | null;
  min_deposit: number | null;
  lock_period_days: number;
  risk_tier: string | null;
  protocol_name: string | null;
  is_active: boolean;
  max_leverage: number | null;
  utilization_pct: number | null;
  liquidity_available_usd: number | null;
  is_automated: boolean | null;
  depeg: number | null;
  underlying_tokens: unknown;
  protocol_url: string | null;
  updated_at: Date | null;
  peg_stability: PegStabilityData | null;
  token_warnings: ShieldWarning[] | null;
}

export interface SearchYieldsResult {
  data: YieldListItem[];
  meta: {
    total: number;
    last_updated: Date | null;
    limit: number;
    offset: number;
  };
}

export interface YieldHistoryResult {
  data: Array<{ snapshot_at: Date | null; apy: number | null; tvl_usd: number | null }>;
  meta: { total: number; period: string };
}

export interface ProtocolListResult {
  data: Array<{
    id: number;
    slug: string;
    name: string;
    description: string | null;
    website_url: string | null;
    logo_url: string | null;
    audit_status: string | null;
    auditors: string[] | null;
    integration: string | null;
  }>;
}

export interface DiscoverService {
  getOpportunityById(id: number): Promise<OpportunityDetail | null>;
  getOpportunityMap(): Promise<Record<string, OpportunityMapEntry>>;
  searchYields(params: SearchYieldsParams): Promise<SearchYieldsResult>;
  getYieldHistory(opportunityId: number, period?: "7d" | "30d" | "90d"): Promise<YieldHistoryResult | null>;
  getProtocols(): Promise<ProtocolListResult>;
}

/** Token exposure entry — stored in underlying_tokens JSONB column. */
export interface UnderlyingToken {
  symbol: string;
  mint: string | null;
  role: string; // "underlying" | "collateral" | "debt" | "pool_a" | "pool_b" | ...
  type: "stablecoin" | "yield_bearing_stable" | "lst" | "volatile";
}

/** JSON-safe instruction format returned by Manage routes. */
export interface SerializableInstruction {
  programAddress: string;
  accounts: Array<{ address: string; role: number }>; // 0=readonly, 1=writable, 2=readonlySigner, 3=writableSigner
  data: string; // base64-encoded
}
