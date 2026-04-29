"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { YieldOpportunity } from "@/lib/api";
import { fmtNum, fmtTvl, fmtCategory, spreadPct, volatilityColor, computeRiskLevel } from "@/lib/format";
import type { SortField } from "@/lib/hooks/useYieldFilters";
import type { ColumnKey } from "@/lib/hooks/useColumnToggle";
import { ProtocolChip } from "@/components/ProtocolChip";

function SortArrow({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: "asc" | "desc" }) {
  const active = sortField === field;
  const arrow = active && sortDir === "asc" ? "\u2191" : "\u2193";
  return <span className={`ml-1 inline-block w-3 text-center ${active ? "text-foreground" : "text-transparent"}`}>{arrow}</span>;
}

function cleanDisplayName(y: YieldOpportunity): string {
  return y.name
    .replace(new RegExp(`^${y.protocol_name}\\s*`, "i"), "")
    .replace(new RegExp(`\\b${fmtCategory(y.category)}\\b\\s*[-—]?\\s*`, "i"), "")
    .replace(/^(Lend|Earn|Borrow|Stake)\s*[-—]\s*/i, "")
    .replace(/^[-—]\s*/, "")
    .trim() || y.name;
}

function yieldRisk(y: YieldOpportunity) {
  const peg = y.peg_stability;
  // Prefer 1d spread (avoids inflating for yield-bearing stables), fall back to 7d
  const sp = peg && peg.snapshot_count_1d >= 2
    ? spreadPct(peg.min_price_1d, peg.max_price_1d)
    : peg && peg.snapshot_count_7d >= 2
      ? spreadPct(peg.min_price_7d, peg.max_price_7d)
      : null;
  const risk = computeRiskLevel({
    tokenWarnings: y.token_warnings,
    spreadPct: sp,
    lockPeriodDays: y.lock_period_days,
    pegLiquidityUsd: peg?.liquidity_usd,
  });
  return { sp, risk };
}

function RiskBadge({ y }: { y: YieldOpportunity }) {
  const { risk } = yieldRisk(y);
  if (risk.reasons.length === 0) {
    return <span className={`text-[0.75rem] font-medium ${risk.colorClass}`}>{risk.label}</span>;
  }
  return (
    <span className="relative group/risk inline-block">
      <span className={`text-[0.75rem] font-medium ${risk.colorClass} cursor-help border-b border-dashed border-current`}>{risk.label}</span>
      <div className="invisible group-hover/risk:visible opacity-0 group-hover/risk:opacity-100 transition-opacity absolute right-0 bottom-full mb-2 z-[100] pointer-events-none bg-[#1a1a1a] border border-outline-ghost rounded-sm px-3 py-2.5 shadow-lg min-w-[180px]">
        <div className="text-[0.6rem] uppercase tracking-[0.05em] text-foreground-muted mb-1.5 font-medium">Risk factors</div>
        {risk.reasons.map((r, i) => (
          <div key={i} className="text-[0.7rem] text-foreground leading-relaxed">• {r}</div>
        ))}
      </div>
    </span>
  );
}

function RiskHeader() {
  return (
    <span className="relative group/rh inline-block cursor-help">
      <span className="border-b border-dashed border-foreground-muted">Risk</span>
      <div className="invisible group-hover/rh:visible opacity-0 group-hover/rh:opacity-100 transition-opacity absolute right-0 top-full mt-2 z-[100] pointer-events-none bg-[#1a1a1a] border border-outline-ghost rounded-sm px-3 py-2.5 shadow-lg min-w-[220px] normal-case tracking-normal font-normal">
        <div className="text-[0.7rem] text-foreground leading-relaxed whitespace-normal">
          Based on token warnings, peg spread, lock periods, and DEX liquidity.
        </div>
        <div className="mt-1.5 space-y-0.5 text-[0.65rem] text-foreground-muted leading-relaxed whitespace-normal">
          <div><span className="text-red-400 font-medium">High</span> — severe warnings or &gt;0.5% spread</div>
          <div><span className="text-yellow-400 font-medium">Medium</span> — any warnings or &gt;0.2% spread</div>
          <div><span className="text-neon font-medium">Low</span> — no issues detected</div>
        </div>
      </div>
    </span>
  );
}

interface ColDef {
  key: ColumnKey;
  label: string;
  align: "left" | "right";
  sortField?: SortField;
  renderHeader?: () => ReactNode;
  renderCell: (y: YieldOpportunity) => ReactNode;
}

const COLUMNS: ColDef[] = [
  {
    key: "name", label: "Name", align: "left",
    renderCell: (y) => <span className="font-medium text-foreground">{cleanDisplayName(y)}</span>,
  },
  {
    key: "protocol", label: "Protocol", align: "left",
    renderCell: (y) => y.protocol_name ? <ProtocolChip slug={y.protocol_name} logoUrl={y.protocol_logo_url} /> : "\u2014",
  },
  {
    key: "strategy", label: "Strategy", align: "left",
    renderCell: (y) => <span className="text-foreground-muted">{fmtCategory(y.category)}</span>,
  },
  {
    key: "tokens", label: "Tokens", align: "left",
    renderCell: (y) => <span className="text-foreground-muted">{y.underlying_tokens?.map((t) => t.symbol).join(", ") ?? y.tokens.join(", ")}</span>,
  },
  {
    key: "tvl", label: "TVL", align: "right", sortField: "tvl",
    renderCell: (y) => <span className="text-foreground-muted tabular-nums">{fmtTvl(y.tvl_usd)}</span>,
  },
  {
    key: "depositCap", label: "Avail. Deposit", align: "right", sortField: "liquidity",
    renderCell: (y) => <span className="text-foreground-muted tabular-nums">{fmtTvl(y.liquidity_available_usd)}</span>,
  },
  {
    key: "apr", label: "APR", align: "right", sortField: "apy",
    renderCell: (y) => (
      <span className="font-semibold text-neon tabular-nums whitespace-nowrap">
        {y.category === "multiply" && y.multiply_info?.collateral_yield_current_pct != null
          ? `${fmtNum(y.multiply_info.collateral_yield_current_pct)}% – ${fmtNum(y.apy_current)}%`
          : `${fmtNum(y.apy_current)}%`}
      </span>
    ),
  },
  {
    key: "apr30d", label: "30D APR", align: "right", sortField: "apy30d",
    renderCell: (y) => <span className="text-foreground-muted tabular-nums">{y.apy_30d_avg != null ? `${fmtNum(y.apy_30d_avg)}%` : "\u2014"}</span>,
  },
  {
    key: "volatility", label: "Peg Spread", align: "right",
    renderCell: (y) => {
      const { sp } = yieldRisk(y);
      return <span className={`tabular-nums ${volatilityColor(sp)}`}>{sp != null ? `${sp.toFixed(2)}%` : "\u2014"}</span>;
    },
  },
  {
    key: "dexLiquidity", label: "DEX Liquidity", align: "right",
    renderCell: (y) => <span className="text-foreground-muted tabular-nums">{fmtTvl(y.peg_stability?.liquidity_usd)}</span>,
  },
  {
    key: "risk", label: "Risk", align: "right",
    renderHeader: () => <RiskHeader />,
    renderCell: (y) => <RiskBadge y={y} />,
  },
];

interface YieldTableProps {
  yields: YieldOpportunity[];
  sortField: SortField;
  sortDir: "asc" | "desc";
  toggleSort: (field: SortField) => void;
  visibleColumns: readonly ColumnKey[];
}

export default function YieldTable({ yields, sortField, sortDir, toggleSort, visibleColumns }: YieldTableProps) {
  const router = useRouter();
  const goTo = (id: number) => router.push(`/yields/${id}`);
  const cols = COLUMNS.filter((c) => visibleColumns.includes(c.key));

  return (
    <>
      {/* Mobile cards */}
      <div className="lg:hidden space-y-2 px-3 py-4">
        {yields.map((y) => {
          const { sp, risk } = yieldRisk(y);
          return (
            <div
              key={y.id}
              className="bg-surface rounded-sm p-4 space-y-3 cursor-pointer active:bg-surface-high transition-colors"
              onClick={() => goTo(y.id)}
            >
              <div>
                <span className="font-display text-sm tracking-[-0.02em]">{cleanDisplayName(y)}</span>
                <span className="ml-2 text-[0.65rem] text-foreground-muted font-sans">{y.tokens.join(", ")}{y.underlying_tokens?.[0]?.type ? ` · ${y.underlying_tokens[0].type.replace(/_/g, " ")}` : ""}</span>
              </div>
              <div className="flex items-center gap-2">
                {y.protocol_name && <ProtocolChip slug={y.protocol_name} logoUrl={y.protocol_logo_url} />}
                <span className="text-[0.65rem] text-foreground-muted font-sans">{fmtCategory(y.category)}</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-baseline">
                  <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Available to Deposit</span>
                  <span className="text-[0.8rem] font-sans tabular-nums text-foreground-muted">{fmtTvl(y.liquidity_available_usd)}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">APR</span>
                  <span className="text-[0.8rem] font-sans tabular-nums text-neon font-semibold">
                    {y.category === "multiply" && y.multiply_info?.collateral_yield_current_pct != null
                      ? `${fmtNum(y.multiply_info.collateral_yield_current_pct)}% – ${fmtNum(y.apy_current)}%`
                      : `${fmtNum(y.apy_current)}%`}
                  </span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">30D APR</span>
                  <span className="text-[0.8rem] font-sans tabular-nums text-foreground-muted">{y.apy_30d_avg != null ? `${fmtNum(y.apy_30d_avg)}%` : "\u2014"}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Peg Spread</span>
                  <span className={`text-[0.8rem] font-sans tabular-nums ${volatilityColor(sp)}`}>
                    {sp != null ? `${sp.toFixed(2)}%` : "\u2014"}
                  </span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Risk</span>
                  <span className={`text-[0.8rem] font-sans font-medium ${risk.colorClass}`}>
                    {risk.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block">
        <table className="w-full text-[0.8rem] font-sans">
          <thead>
            <tr className="text-foreground-muted uppercase text-[0.6rem] tracking-[0.05em] bg-surface">
              {cols.map((col) => (
                <th
                  key={col.key}
                  className={`${col.align === "left" ? "text-left" : "text-right"} px-5 py-2.5 align-middle font-medium whitespace-nowrap ${
                    col.sortField ? "cursor-pointer select-none hover:text-foreground transition-colors" : ""
                  }`}
                  onClick={col.sortField ? () => toggleSort(col.sortField!) : undefined}
                >
                  {col.renderHeader ? col.renderHeader() : col.label}
                  {col.sortField && <SortArrow sortField={sortField} sortDir={sortDir} field={col.sortField} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {yields.map((y) => (
              <tr
                key={y.id}
                className="hover:bg-surface-high transition-colors cursor-pointer"
                onClick={() => goTo(y.id)}
              >
                {cols.map((col) => (
                  <td key={col.key} className={`px-5 py-3 align-middle ${col.align === "right" ? "text-right" : ""}`}>
                    {col.renderCell(y)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
