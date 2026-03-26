import type { CategoryDefinition } from "../registry";
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
    return [
      { label: "Liquidity Available", value: fmtTvl(y.liquidity_available_usd) },
      { label: "Max Leverage", value: y.max_leverage != null ? `${y.max_leverage}x` : "\u2014" },
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
    if (extra.borrow_apy_current_pct != null) fields.push({ label: "Borrow APY", value: fmtApy(extra.borrow_apy_current_pct) });
    if (y.utilization_pct != null) fields.push({ label: "Utilization", value: `${y.utilization_pct.toFixed(1)}%` });
    return fields;
  },

  actionPanelType: "custom",
  actionPanelComponent: () => import("@/components/MultiplyPanel"),
  transactionType: "multi-step",
};
