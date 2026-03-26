import type { CategoryDefinition } from "../registry";
import { fmtApy, fmtTvl, fmtUsd, fmtPct, fmtDays, fmtVaultTag, pnlColor, truncateId } from "@/lib/format";
import { getMultiplyExtra } from "../extra-data";
import { ApyCell } from "@/components/PositionTable";

export const multiplyCategory: CategoryDefinition = {
  slug: "multiply",
  displayName: "Multiply",
  sidebarLabel: "MULTIPLY",

  titleFormatter: (y) => {
    const extra = getMultiplyExtra(y.extra_data, y.tokens);
    return `${extra.collateral_symbol}/${extra.debt_symbol} Multiply`;
  },

  statsGrid: (y) => {
    const extra = getMultiplyExtra(y.extra_data, y.tokens);
    return [
      { label: "Liquidity Available", value: fmtTvl(y.liquidity_available_usd) },
      { label: "Max Leverage", value: y.max_leverage != null ? `${y.max_leverage}x` : "\u2014" },
      { label: "Max Leverage APY", value: fmtApy(extra.net_apy_current_pct), colorClass: "text-neon" },
    ];
  },

  detailFields: (y) => {
    const extra = getMultiplyExtra(y.extra_data, y.tokens);
    const fields = [];

    // Collateral/debt pair info is rendered as custom JSX by CategoryDetailView
    // using the detailPanelLabel "Looping Overview"
    if (extra.collateral_ltv != null) {
      fields.push({
        label: "Collateral Asset",
        value: `${extra.collateral_symbol} — Max LTV ${(extra.collateral_ltv * 100).toFixed(0)}%`,
      });
    } else {
      fields.push({ label: "Collateral Asset", value: extra.collateral_symbol });
    }

    if (extra.collateral_liquidation_threshold != null) {
      fields.push({
        label: "Debt Asset",
        value: `${extra.debt_symbol} — Liq LTV ${(extra.collateral_liquidation_threshold * 100).toFixed(0)}%`,
      });
    } else {
      fields.push({ label: "Debt Asset", value: extra.debt_symbol });
    }

    if (extra.leverage_used != null) fields.push({ label: "Avg Leverage Taken", value: `${extra.leverage_used.toFixed(2)}x` });
    if (extra.borrow_apy_current_pct != null) fields.push({ label: "Borrow APY", value: fmtApy(extra.borrow_apy_current_pct) });
    if (y.utilization_pct != null) fields.push({ label: "Utilization", value: `${y.utilization_pct.toFixed(1)}%` });
    return fields;
  },

  actionPanelType: "custom",
  actionPanelComponent: () => import("@/components/MultiplyPanel"),
  transactionType: "multi-step",

  positionColumns: (detailsAction) => [
    { header: "Strategy", align: "left", render: (p) => <span className="text-foreground">{truncateId(p.external_id)}</span> },
    { header: "Token", align: "left", render: (p) => <span className="text-foreground-muted">{p.token_symbol ?? "\u2014"}</span> },
    { header: "Net Value", align: "right", render: (p) => fmtUsd(p.deposit_amount_usd) },
    { header: "Net APY", align: "right", render: (p) => <ApyCell position={p} /> },
    { header: "PnL ($)", align: "right", render: (p) => <span className={pnlColor(p.pnl_usd)}>{fmtUsd(p.pnl_usd)}</span> },
    { header: "PnL (%)", align: "right", render: (p) => <span className={pnlColor(p.pnl_pct)}>{fmtPct(p.pnl_pct)}</span> },
    { header: "Days Held", align: "right", render: (p) => <span className="text-foreground-muted">{fmtDays(p.held_days)}</span> },
    detailsAction,
  ],

  positionCardFields: (p) => {
    const forwardApy = (p.extra_data as Record<string, unknown> | null)?.forward_apy as number | null | undefined;
    const apyStr = forwardApy != null && p.apy !== forwardApy
      ? `${fmtApy(p.apy)} (${fmtApy(forwardApy)} mkt)`
      : fmtApy(p.apy);
    return [
      { label: "Net Value", value: fmtUsd(p.deposit_amount_usd) },
      { label: "Net APY", value: apyStr, colorClass: "text-neon" },
      { label: "PnL ($)", value: fmtUsd(p.pnl_usd), colorClass: pnlColor(p.pnl_usd) },
      { label: "PnL (%)", value: fmtPct(p.pnl_pct), colorClass: pnlColor(p.pnl_pct) },
      { label: "Days Held", value: fmtDays(p.held_days) },
    ];
  },
};
