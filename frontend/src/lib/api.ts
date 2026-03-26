import { API_URL } from "./constants";

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
  protocol_url: string | null;
  updated_at: string | null;
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
  is_closed: boolean | null;
  closed_at: string | null;
  close_value_usd: number | null;
  token_symbol: string | null;
  extra_data: Record<string, unknown> | null;
  snapshot_at: string;
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

export const api = {
  getYields: (params?: { category?: string; sort?: string; tokens?: string; stablecoins_only?: boolean }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params ?? {}).filter(([, v]) => v != null) as [string, string][]
      )
    ).toString();
    return apiFetch<{ data: YieldOpportunity[]; meta: { total: number; last_updated: string | null } }>(
      `/api/yields${qs ? `?${qs}` : ""}`
    );
  },

  getYieldDetail: (id: number) =>
    apiFetch<YieldOpportunityDetail>(`/api/yields/${id}`),

  getYieldHistory: (id: number, period: string = "7d") =>
    apiFetch<{ data: YieldHistoryPoint[] }>(`/api/yields/${id}/history?period=${period}`),

  getProtocols: () =>
    apiFetch<{ data: Protocol[] }>("/api/protocols"),

  getPortfolio: (walletAddress: string) =>
    apiFetch<Portfolio>(`/api/portfolio/${walletAddress}`),

  getHealth: () =>
    apiFetch<{ status: string }>("/api/health"),

  trackWallet: (() => {
    const cache = new Map<string, number>();
    const THROTTLE_MS = 60_000;
    return (wallet: string) => {
      const now = Date.now();
      if (now - (cache.get(wallet) ?? 0) < THROTTLE_MS) return Promise.resolve();
      cache.set(wallet, now);
      return fetch(`${API_URL}/api/portfolio/${wallet}/track`, { method: "POST" })
        .then(r => r.json()).catch(() => {});
    };
  })(),

  getPositions: (wallet: string, params?: { protocol?: string; product_type?: string }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v != null) as [string, string][])
    ).toString();
    return apiFetch<UserPositionOut[]>(`/api/portfolio/${wallet}/positions${qs ? `?${qs}` : ""}`);
  },

  getPositionHistory: (wallet: string, period: "7d" | "30d" | "90d" = "7d") =>
    apiFetch<UserPositionHistoryPoint[]>(`/api/portfolio/${wallet}/positions/history?period=${period}`),

  getWalletStatus: (wallet: string) =>
    apiFetch<{ fetch_status: string; last_fetched_at: string | null }>(
      `/api/portfolio/${wallet}/status`
    ),

  getPositionEvents: (wallet: string) =>
    apiFetch<UserPositionEventOut[]>(`/api/portfolio/${wallet}/events`),
};
