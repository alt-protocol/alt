import type { CategoryDefinition } from "../registry";
import { fmtApy, fmtTvl, fmtUsd, fmtDays, pnlColor, truncateId } from "@/lib/format";
import { ApyCell } from "@/components/PositionTable";

export const insuranceFundCategory: CategoryDefinition = {
  slug: "insurance_fund",
  displayName: "Insurance Fund",
  sidebarLabel: "INSURANCE FUNDS",

  statsGrid: (y) => [
    { label: "APY Now", value: fmtApy(y.apy_current) },
    { label: "7D Avg", value: fmtApy(y.apy_7d_avg) },
    { label: "30D Avg", value: fmtApy(y.apy_30d_avg) },
    { label: "TVL", value: fmtTvl(y.tvl_usd) },
  ],

  detailFields: (y) => {
    const fields = [];
    if (y.tokens.length > 0) fields.push({ label: "Tokens", value: y.tokens.join(", ") });
    if (y.min_deposit != null) fields.push({ label: "Min Deposit", value: fmtTvl(y.min_deposit) });
    if (y.lock_period_days > 0) fields.push({ label: "Lock Period", value: `${y.lock_period_days}d` });
    return fields;
  },

  actionPanelType: "deposit-withdraw",
  transactionType: "simple",

  positionColumns: (detailsAction) => [
    { header: "Fund", align: "left", render: (p) => <span className="text-foreground">{truncateId(p.external_id)}</span> },
    { header: "Token", align: "left", render: (p) => <span className="text-foreground-muted">{p.token_symbol ?? "\u2014"}</span> },
    { header: "Net Value", align: "right", render: (p) => fmtUsd(p.deposit_amount_usd) },
    { header: "APY", align: "right", render: (p) => <ApyCell position={p} /> },
    { header: "PnL", align: "right", render: (p) => <span className={pnlColor(p.pnl_usd)}>{fmtUsd(p.pnl_usd)}</span> },
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
      { label: "APY", value: apyStr, colorClass: "text-neon" },
      { label: "PnL", value: fmtUsd(p.pnl_usd), colorClass: pnlColor(p.pnl_usd) },
      { label: "Days Held", value: fmtDays(p.held_days) },
    ];
  },
};
