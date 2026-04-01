import type { CategoryDefinition } from "../registry";
import { fmtApy, fmtTvl, truncateId } from "@/lib/format";

export const lendingCategory: CategoryDefinition = {
  slug: "lending",
  displayName: "Lending",
  sidebarLabel: "LEND",
  uncappedLiquidity: true,

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
    if (y.utilization_pct != null) fields.push({ label: "Utilization", value: `${y.utilization_pct.toFixed(1)}%` });
    if (y.deposit_address) fields.push({ label: "Deposit Address", value: truncateId(y.deposit_address, 20) });
    return fields;
  },

  actionPanelType: "deposit-withdraw",
  transactionType: "simple",
};
