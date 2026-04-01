import type { CategoryDefinition, ChartReferenceLine } from "../registry";
import { fmtApy, fmtTvl, fmtVaultTag } from "@/lib/format";
import { getMultiplyExtra } from "../extra-data";

export const multiplyCategory: CategoryDefinition = {
  slug: "multiply",
  displayName: "Multiply",
  sidebarLabel: "MULTIPLY",

  titleFormatter: (y) => {
    const extra = getMultiplyExtra(y.extra_data, y.tokens);
    return `${extra.collateral_symbol}/${extra.debt_symbol} Multiply`;
  },

  detailSectionLabel: "Looping Overview",

  titleBadge: (y) => {
    const extra = getMultiplyExtra(y.extra_data, y.tokens);
    return extra.vault_tag ? fmtVaultTag(extra.vault_tag) : null;
  },

  statsGrid: (y) => {
    const extra = getMultiplyExtra(y.extra_data, y.tokens);
    const maxLev = y.max_leverage
      ?? extra.max_leverage
      ?? (extra.leverage_table
        ? Math.max(...Object.keys(extra.leverage_table).map(Number).filter(Number.isFinite))
        : null);
    return [
      { label: "Liquidity Available", value: fmtTvl(y.liquidity_available_usd) },
      { label: "Max Leverage", value: maxLev != null && maxLev > 0 ? `${maxLev}x` : "\u2014" },
      { label: "Max Leverage APY", value: fmtApy(extra.net_apy_current_pct), colorClass: "text-neon" },
    ];
  },

  detailFields: (y) => {
    const extra = getMultiplyExtra(y.extra_data, y.tokens);
    const fields = [];

    if (extra.collateral_ltv != null) {
      fields.push({
        label: "Collateral Asset",
        value: `${extra.collateral_symbol} \u2014 Max LTV ${(extra.collateral_ltv * 100).toFixed(0)}%`,
      });
    } else {
      fields.push({ label: "Collateral Asset", value: extra.collateral_symbol });
    }

    if (extra.collateral_liquidation_threshold != null) {
      fields.push({
        label: "Debt Asset",
        value: `${extra.debt_symbol} \u2014 Liq LTV ${(extra.collateral_liquidation_threshold * 100).toFixed(0)}%`,
      });
    } else {
      fields.push({ label: "Debt Asset", value: extra.debt_symbol });
    }

    if (extra.leverage_used != null) fields.push({ label: "Avg Leverage Taken", value: `${extra.leverage_used.toFixed(2)}x` });
    if (extra.collateral_yield_current_pct != null) fields.push({ label: "Supply APY", value: fmtApy(extra.collateral_yield_current_pct) });
    if (extra.borrow_apy_current_pct != null) fields.push({ label: "Borrow APY", value: fmtApy(extra.borrow_apy_current_pct) });
    if (y.utilization_pct != null) fields.push({ label: "Utilization", value: `${y.utilization_pct.toFixed(1)}%` });

    // Leverage table
    if (extra.leverage_table) {
      const entries = Object.entries(extra.leverage_table)
        .map(([k, v]) => ({ lev: parseFloat(k), ...v }))
        .filter((e) => Number.isFinite(e.lev))
        .sort((a, b) => a.lev - b.lev);
      for (const e of entries) {
        const current = fmtApy(e.net_apy_current_pct);
        const avg30d = e.net_apy_30d_pct != null ? fmtApy(e.net_apy_30d_pct) : null;
        fields.push({
          label: `Net APY at ${e.lev}x`,
          value: avg30d ? `${current} (30d: ${avg30d})` : current,
        });
      }
    }

    return fields;
  },

  actionPanelType: "custom",
  actionPanelComponent: () => import("@/components/MultiplyPanel"),
  transactionType: "multi-step",

  chartReferenceLines: (y) => {
    const extra = getMultiplyExtra(y.extra_data, y.tokens);
    const lines: ChartReferenceLine[] = [];
    if (extra.borrow_apy_current_pct != null) {
      lines.push({ value: extra.borrow_apy_current_pct, label: "Borrow", color: "var(--foreground-muted)" });
    }
    return lines;
  },

  strategyDescription: (y) => {
    const extra = getMultiplyExtra(y.extra_data, y.tokens);
    const liqPct = extra.collateral_liquidation_threshold != null
      ? `${(extra.collateral_liquidation_threshold * 100).toFixed(0)}%` : null;
    let desc = `Deposits ${extra.collateral_symbol}, borrows ${extra.debt_symbol}, and loops to amplify yield exposure.`;
    if (liqPct) desc += ` Liquidation threshold: ${liqPct} LTV.`;
    desc += ` If ${extra.debt_symbol} depegs, effective LTV may spike, triggering liquidation.`;
    desc += ` Higher leverage increases both yield and risk.`;
    return desc;
  },
};
