import type { CategoryDefinition } from "../registry";
import { fmtApy, fmtTvl } from "@/lib/format";

/** Shared definition for both "vault" and "earn_vault" categories. */
function makeVaultDef(slug: string, displayName: string, sidebarLabel: string): CategoryDefinition {
  return {
    slug,
    displayName,
    sidebarLabel,

    statsGrid: (y) => [
      { label: "APY Now", value: fmtApy(y.apy_current) },
      { label: "7D Avg", value: fmtApy(y.apy_7d_avg) },
      { label: "30D Avg", value: fmtApy(y.apy_30d_avg) },
      { label: "TVL", value: fmtTvl(y.tvl_usd) },
    ],

    detailFields: (y) => {
      const fields = [];
      if (y.tokens.length > 0) fields.push({ label: "Tokens", value: y.tokens.join(", ") });
      if (y.underlying_tokens?.length) {
        fields.push({
          label: "Underlying Exposure",
          value: y.underlying_tokens.map((t) => `${t.symbol} (${t.type.replace(/_/g, " ")})`).join(" / "),
        });
      }
      if (y.min_deposit != null) fields.push({ label: "Min Deposit", value: fmtTvl(y.min_deposit) });
      if (y.lock_period_days > 0) fields.push({ label: "Lock Period", value: `${y.lock_period_days}d` });
      if (y.liquidity_available_usd != null) fields.push({ label: "Remaining Capacity", value: fmtTvl(y.liquidity_available_usd) });
      if (y.is_automated != null) fields.push({ label: "Automated", value: y.is_automated ? "Yes" : "No" });
      return fields;
    },

    actionPanelType: "deposit-withdraw",
    transactionType: "simple",
  };
}

export const vaultCategory = makeVaultDef("vault", "Vault", "KAMINO LP");
export const earnVaultCategory = makeVaultDef("earn_vault", "Earn Vault", "EARN VAULTS");
