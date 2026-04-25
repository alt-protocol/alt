import { API_URL } from "./constants";
import type { BuildTxApiResponse } from "./instruction-deserializer";
import type { WithdrawState } from "./tx-types";

export type { BuildTxApiResponse };

export interface Protocol {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  website_url: string | null;
  logo_url: string | null;
  audit_status: string | null;
  auditors: string[] | null;
  integration: string;
}

export interface UnderlyingToken {
  symbol: string;
  mint: string | null;
  role: string;
  type: "stablecoin" | "yield_bearing_stable" | "lst" | "volatile";
}

export interface PegStability {
  symbol: string;
  price_current: number | null;
  peg_type: "fixed" | "yield_bearing";
  peg_target: number | null;
  peg_adherence_7d: number | null;
  max_deviation_7d: number | null;
  peg_adherence_30d: number | null;
  max_deviation_30d: number | null;
  volatility_7d: number | null;
  volatility_30d: number | null;
  min_price_7d: number | null;
  max_price_7d: number | null;
  min_price_30d: number | null;
  max_price_30d: number | null;
  snapshot_count_7d: number;
  snapshot_count_30d: number;
  liquidity_usd: number | null;
}

export interface ShieldWarning {
  type: string;
  message: string;
  severity: "info" | "warning";
}

export interface YieldOpportunity {
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
  underlying_tokens: UnderlyingToken[] | null;
  protocol_url: string | null;
  updated_at: string | null;
  peg_stability: PegStability | null;
  token_warnings: ShieldWarning[] | null;
}

export interface YieldOpportunityDetail extends YieldOpportunity {
  extra_data: Record<string, unknown> | null;
  deposit_address: string | null;
  protocol: Protocol | null;
  recent_snapshots: YieldHistoryPoint[];
}

export interface YieldHistoryPoint {
  snapshot_at: string;
  apy: number | null;
  tvl_usd: number | null;
}

export interface PortfolioPosition {
  mint: string;
  symbol: string | null;
  amount: number;
  decimals: number;
  ui_amount: number;
  is_stablecoin: boolean;
}

export interface Portfolio {
  wallet: string;
  positions: PortfolioPosition[];
  total_value_usd: number;
}

export interface UserPositionOut {
  id: number;
  wallet_address: string;
  protocol_slug: string;
  product_type: string;
  external_id: string;
  opportunity_id: number | null;
  deposit_amount: number | null;
  deposit_amount_usd: number | null;
  pnl_usd: number | null;
  pnl_pct: number | null;
  initial_deposit_usd: number | null;
  opened_at: string | null;
  held_days: number | null;
  apy: number | null;
  apy_realized: number | null;
  is_closed: boolean | null;
  closed_at: string | null;
  close_value_usd: number | null;
  token_symbol: string | null;
  underlying_tokens: UnderlyingToken[] | null;
  lock_period_days: number;
  extra_data: Record<string, unknown> | null;
  snapshot_at: string;
}

export interface DistributionItem {
  label: string;
  value_usd: number;
  pct: number;
}

export interface PortfolioAnalytics {
  summary: {
    total_value_usd: number;
    total_pnl_usd: number;
    total_initial_deposit_usd: number;
    roi_pct: number;
    weighted_apy: number;
    weighted_apy_realized: number;
    projected_yield_yearly_usd: number;
    position_count: number;
  };
  stablecoin: {
    total_usd: number;
    idle_usd: number;
    allocated_usd: number;
    allocation_pct: number;
    apy_total: number;
    apy_allocated: number;
    idle_balances: Array<{ mint: string; symbol: string | null; ui_amount: number }>;
  };
  diversification: {
    by_protocol: DistributionItem[];
    by_category: DistributionItem[];
    by_token: DistributionItem[];
  };
}

export interface UserPositionHistoryPoint {
  snapshot_at: string;
  deposit_amount_usd: number | null;
  pnl_usd: number | null;
  pnl_pct: number | null;
}

export interface UserPositionEventOut {
  id: number;
  wallet_address: string;
  protocol_slug: string;
  product_type: string;
  external_id: string;
  event_type: string;
  amount: number | null;
  amount_usd: number | null;
  tx_signature: string | null;
  event_at: string;
  extra_data: Record<string, unknown> | null;
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `API error ${res.status}` }));
    throw new Error(err.error ?? err.details ?? `API error ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // --- Discover module ---
  getYields: (params?: {
    category?: string;
    sort?: string;
    tokens?: string;
    asset_class?: string;
    protocol?: string;
    token_type?: string;
    apy_min?: number;
    apy_max?: number;
    tvl_min?: number;
    tvl_max?: number;
    liquidity_min?: number;
    liquidity_max?: number;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params ?? {}).filter(([, v]) => v != null) as [string, string][]
      )
    ).toString();
    return apiFetch<{ data: YieldOpportunity[]; meta: { total: number; last_updated: string | null } }>(
      `/api/discover/yields${qs ? `?${qs}` : ""}`
    );
  },

  getYieldDetail: (id: number) =>
    apiFetch<YieldOpportunityDetail>(`/api/discover/yields/${id}`),

  getYieldHistory: (id: number, period: string = "7d") =>
    apiFetch<{ data: YieldHistoryPoint[] }>(`/api/discover/yields/${id}/history?period=${period}`),

  getProtocols: () =>
    apiFetch<{ data: Protocol[] }>("/api/discover/protocols"),

  // --- Monitor module ---
  getPortfolio: (walletAddress: string) =>
    apiFetch<Portfolio>(`/api/monitor/portfolio/${walletAddress}`),

  trackWallet: (() => {
    const cache = new Map<string, number>();
    const THROTTLE_MS = 60_000;
    return (wallet: string) => {
      const now = Date.now();
      if (now - (cache.get(wallet) ?? 0) < THROTTLE_MS) return Promise.resolve();
      cache.set(wallet, now);
      return fetch(`${API_URL}/api/monitor/portfolio/${wallet}/track`, { method: "POST" })
        .then(r => r.json()).catch(() => {});
    };
  })(),

  /** Sync a single position to Monitor DB after transaction. No throttle. */
  syncPosition: (wallet: string, opportunityId: number, metadata?: Record<string, unknown>) =>
    fetch(`${API_URL}/api/monitor/portfolio/${wallet}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunity_id: opportunityId, metadata }),
    }).then(r => r.json()).catch(() => {}),

  getPositions: (wallet: string, params?: { protocol?: string; product_type?: string }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v != null) as [string, string][])
    ).toString();
    return apiFetch<UserPositionOut[]>(`/api/monitor/portfolio/${wallet}/positions${qs ? `?${qs}` : ""}`);
  },

  getPositionHistory: (wallet: string, period: "7d" | "30d" | "90d" = "7d") =>
    apiFetch<UserPositionHistoryPoint[]>(`/api/monitor/portfolio/${wallet}/positions/history?period=${period}`),

  getWalletStatus: (wallet: string) =>
    apiFetch<{ fetch_status: string; last_fetched_at: string | null }>(
      `/api/monitor/portfolio/${wallet}/status`
    ),

  getPositionEvents: (wallet: string) =>
    apiFetch<UserPositionEventOut[]>(`/api/monitor/portfolio/${wallet}/events`),

  getPortfolioAnalytics: (wallet: string) =>
    apiFetch<PortfolioAnalytics>(`/api/monitor/portfolio/${wallet}/analytics`),

  // --- Manage module ---
  buildDeposit: (params: {
    opportunity_id: number;
    wallet_address: string;
    amount: string;
    simulate?: boolean;
    extra_data?: Record<string, unknown>;
  }) => apiPost<BuildTxApiResponse>("/api/manage/tx/build-deposit", params),

  buildWithdraw: (params: {
    opportunity_id: number;
    wallet_address: string;
    amount: string;
    simulate?: boolean;
    extra_data?: Record<string, unknown>;
  }) => apiPost<BuildTxApiResponse>("/api/manage/tx/build-withdraw", params),

  getBalance: (params: { opportunity_id: number; wallet_address: string }) =>
    apiPost<{ balance: number | null }>("/api/manage/balance", params),

  getWalletBalance: (params: { wallet_address: string; mint: string; fresh?: boolean }) =>
    apiPost<{ balance: number }>("/api/manage/wallet-balance", params),

  getWithdrawState: (params: { opportunity_id: number; wallet_address: string }) =>
    apiPost<WithdrawState | null>("/api/manage/withdraw-state", params),

  getPositionStats: (params: { opportunity_id: number; wallet_address: string }) =>
    apiPost<{
      balance: number;
      leverage: number;
      ltv: number;
      liquidationLtv: number;
      totalDepositUsd: number;
      totalBorrowUsd: number;
      borrowLimit: number;
      healthFactor: number;
    } | null>("/api/manage/tx/position-stats", params),

  getPriceImpact: (params: {
    opportunity_id: number;
    wallet_address: string;
    amount: string;
    direction: "deposit" | "withdraw";
    extra_data?: Record<string, unknown>;
  }) =>
    apiPost<{
      priceImpactPct: number;
      inputAmount: number;
      inputSymbol: string;
      outputExpected: number;
      outputActual: number;
      outputSymbol: string;
    } | null>("/api/manage/tx/price-impact", params),

  // --- Health ---
  getHealth: () =>
    apiFetch<{ status: string }>("/api/health"),
};
