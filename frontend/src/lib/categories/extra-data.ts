/* Typed extra_data extractors per category.
   Replaces ad-hoc `(extra.field as Type) ?? fallback` casts. */

export interface MultiplyExtraData {
  collateral_symbol: string;
  debt_symbol: string;
  vault_tag: string | null;
  net_apy_current_pct: number | null;
  collateral_ltv: number | null;
  collateral_liquidation_threshold: number | null;
  leverage_used: number | null;
  borrow_apy_current_pct: number | null;
  leverage_table: Record<string, { net_apy_current_pct: number }> | null;
}

export function getMultiplyExtra(
  raw: Record<string, unknown> | null | undefined,
  tokens?: string[],
): MultiplyExtraData {
  const r = raw ?? {};
  return {
    collateral_symbol: (r.collateral_symbol as string) ?? tokens?.[0] ?? "\u2014",
    debt_symbol: (r.debt_symbol as string) ?? tokens?.[1] ?? "\u2014",
    vault_tag: (r.vault_tag as string) ?? null,
    net_apy_current_pct: (r.net_apy_current_pct as number) ?? null,
    collateral_ltv: (r.collateral_ltv as number) ?? null,
    collateral_liquidation_threshold: (r.collateral_liquidation_threshold as number) ?? null,
    leverage_used: (r.leverage_used as number) ?? null,
    borrow_apy_current_pct: (r.borrow_apy_current_pct as number) ?? null,
    leverage_table: (r.leverage_table as MultiplyExtraData["leverage_table"]) ?? null,
  };
}

export interface LendingExtraData {
  forward_apy: number | null;
}

export function getLendingExtra(raw: Record<string, unknown> | null | undefined): LendingExtraData {
  const r = raw ?? {};
  return {
    forward_apy: (r.forward_apy as number) ?? null,
  };
}
