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
  is_active: boolean;
  updated_at: string | null;
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

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  getYields: (params?: { category?: string; sort?: string; tokens?: string }) => {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params ?? {}).filter(([, v]) => v != null) as [string, string][]
      )
    ).toString();
    return apiFetch<{ data: YieldOpportunity[]; meta: { total: number; last_updated: string | null } }>(
      `/api/yields${qs ? `?${qs}` : ""}`
    );
  },

  getYieldHistory: (id: number, period: string = "7d") =>
    apiFetch<{ data: YieldHistoryPoint[] }>(`/api/yields/${id}/history?period=${period}`),

  getProtocols: () =>
    apiFetch<{ data: Protocol[] }>("/api/protocols"),

  getPortfolio: (walletAddress: string) =>
    apiFetch<Portfolio>(`/api/portfolio/${walletAddress}`),

  getHealth: () =>
    apiFetch<{ status: string }>("/api/health"),
};
