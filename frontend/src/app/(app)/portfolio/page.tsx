"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { fmtUsd, fmtPct, fmtApy, pnlColor, truncateId } from "@/lib/format";
import PositionTable, { getColumnsForType } from "@/components/PositionTable";
import StatsGrid from "@/components/StatsGrid";
import PeriodSelector from "@/components/PeriodSelector";
import { LoadingSkeleton, NoWalletState, ErrorState, SyncingState } from "@/components/PortfolioStates";
import DiversificationSection from "@/components/DiversificationSection";
import ColumnToggle from "@/components/ColumnToggle";
import { usePortfolioData } from "@/lib/hooks/usePortfolioData";
import { usePositionColumnToggle, POSITION_COLUMN_LABELS } from "@/lib/hooks/usePositionColumnToggle";
import type { PositionColumnKey } from "@/lib/hooks/usePositionColumnToggle";
import { getAllCategories } from "@/lib/categories";
import type { ChartPoint } from "@/lib/hooks/usePortfolioData";
import type { UserPositionOut, PortfolioAnalytics } from "@/lib/api";

const PortfolioChart = dynamic(() => import("@/components/PortfolioChart"), { ssr: false });

const HEADER_TO_COL_KEY: Record<string, PositionColumnKey> = {
  "Protocol": "protocol",
  "Type": "type", "Strategy": "type",
  "Token": "token",
  "Net Value": "netValue",
  "PnL": "pnl", "PnL ($)": "pnl", "PnL (%)": "pnl", "Interest Earned": "pnl",
  "APY Current": "apyCurrent",
  "APY Realized": "apyRealized",
  "Proj. Yield/yr": "projYield",
  "Days Held": "held", "Held": "held", "Lock": "held",
  "Market": "token", "Vault": "token", "Fund": "token",
};

const STRATEGY_TYPES = [
  ...getAllCategories().map((c) => ({ key: c.slug, label: c.sidebarLabel })),
];

type ChartMetric = "value" | "pnl";
const CHART_METRICS: { key: ChartMetric; label: string }[] = [
  { key: "value", label: "Net Value" },
  { key: "pnl", label: "PnL" },
];

interface ChartCardProps {
  chartData: ChartPoint[];
  period: "7d" | "30d" | "90d";
  onPeriod: (p: "7d" | "30d" | "90d") => void;
  metric: ChartMetric;
  onMetric: (m: ChartMetric) => void;
  isSuccess: boolean;
}

function ChartCard({ chartData, period, onPeriod, metric, onMetric, isSuccess }: ChartCardProps) {
  return (
    <div className="bg-surface-low rounded-sm mb-[2.25rem]">
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {CHART_METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => onMetric(m.key)}
              className={`px-2.5 py-1 rounded-sm text-[0.7rem] font-sans transition-colors ${
                metric === m.key
                  ? "bg-surface-high text-foreground"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <PeriodSelector value={period} onChange={onPeriod} />
      </div>

      {isSuccess && chartData.length === 0 ? (
        <div className="h-[180px] flex items-center justify-center">
          <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans">No history data</p>
        </div>
      ) : (
        <PortfolioChart
          data={chartData}
          dataKey={metric}
          label={metric === "pnl" ? "PnL" : "Value"}
        />
      )}
    </div>
  );
}

interface SidebarProps {
  filterMode: "strategy" | "protocol";
  setFilterMode: (m: "strategy" | "protocol") => void;
  byType: Record<string, UserPositionOut[]>;
  byProtocol: Record<string, UserPositionOut[]>;
  totalCount: number;
  idleCount: number;
  activeFilter: string;
  onSelect: (t: string) => void;
}

function PositionSidebar({ filterMode, setFilterMode, byType, byProtocol, totalCount, idleCount, activeFilter, onSelect }: SidebarProps) {
  const strategyItems = STRATEGY_TYPES.filter(({ key }) => (byType[key]?.length ?? 0) > 0);
  const protocolItems = Object.keys(byProtocol).sort().map((slug) => ({ key: slug, label: slug.toUpperCase() }));

  const baseItems = filterMode === "strategy" ? strategyItems : protocolItems;

  const getCount = (key: string) => {
    if (key === "all") return totalCount;
    if (key === "idle") return idleCount;
    return filterMode === "strategy" ? (byType[key]?.length ?? 0) : (byProtocol[key]?.length ?? 0);
  };

  return (
    <div className="w-full lg:w-[180px] shrink-0 bg-surface-low">
      <div className="flex">
        <button
          onClick={() => { setFilterMode("strategy"); onSelect("all"); }}
          className={`flex-1 py-2 text-[0.65rem] font-sans uppercase tracking-[0.05em] transition-colors ${
            filterMode === "strategy" ? "text-neon bg-surface-high" : "text-foreground-muted hover:text-foreground bg-surface-low"
          }`}
        >
          Strategy
        </button>
        <button
          onClick={() => { setFilterMode("protocol"); onSelect("all"); }}
          className={`flex-1 py-2 text-[0.65rem] font-sans uppercase tracking-[0.05em] transition-colors ${
            filterMode === "protocol" ? "text-neon bg-surface-high" : "text-foreground-muted hover:text-foreground bg-surface-low"
          }`}
        >
          Protocol
        </button>
      </div>
      <div className="flex lg:flex-col overflow-x-auto">
        {/* Category/Protocol items */}
        {baseItems.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onSelect(activeFilter === key ? "all" : key)}
            className={`flex justify-between items-center gap-2 px-4 py-2 text-[0.7rem] font-sans uppercase tracking-[0.05em] transition-colors text-left whitespace-nowrap lg:w-full ${
              activeFilter === key ? "text-neon bg-surface-high" : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <span>{label}</span>
            <span className="text-foreground-muted text-[0.6rem] tabular-nums">{getCount(key)}</span>
          </button>
        ))}

        {/* ALL — at bottom of categories */}
        <div className="hidden lg:block border-t border-outline-ghost my-1" />
        <button
          onClick={() => onSelect("all")}
          className={`flex justify-between items-center gap-2 px-4 py-2 text-[0.7rem] font-sans uppercase tracking-[0.05em] transition-colors text-left whitespace-nowrap lg:w-full ${
            activeFilter === "all" ? "text-neon bg-surface-high" : "text-foreground-muted hover:text-foreground"
          }`}
        >
          <span>All Positions</span>
          <span className="text-foreground-muted text-[0.6rem] tabular-nums">{totalCount}</span>
        </button>

        {/* Not Deposited — separated with divider */}
        {idleCount > 0 && (
          <>
            <div className="hidden lg:block border-t border-outline-ghost my-1" />
            <button
              onClick={() => onSelect(activeFilter === "idle" ? "all" : "idle")}
              className={`flex justify-between items-center gap-2 px-4 py-2 text-[0.7rem] font-sans uppercase tracking-[0.05em] transition-colors text-left whitespace-nowrap lg:w-full ${
                activeFilter === "idle" ? "text-neon bg-surface-high" : "text-foreground-muted hover:text-foreground"
              }`}
            >
              <span>Not Deposited</span>
              <span className="text-foreground-muted text-[0.6rem] tabular-nums">{idleCount}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function IdleTokensTable({ balances }: { balances: PortfolioAnalytics["stablecoin"]["idle_balances"] }) {
  if (balances.length === 0) {
    return (
      <div className="flex-1 bg-surface px-6 py-8 text-center">
        <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans">No idle stablecoins</p>
      </div>
    );
  }
  return (
    <div className="flex-1 bg-surface">
      <table className="w-full text-[0.8rem] font-sans">
        <thead>
          <tr className="text-foreground-muted uppercase text-[0.6rem] tracking-[0.05em] bg-surface">
            <th className="text-left px-5 py-2.5 align-middle font-medium">Token</th>
            <th className="text-right px-5 py-2.5 align-middle font-medium">Amount</th>
            <th className="text-right px-5 py-2.5 align-middle font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => (
            <tr key={b.mint} className="hover:bg-surface-high transition-colors">
              <td className="px-5 py-3 align-middle font-display tracking-[-0.02em]">
                {b.symbol ?? truncateId(b.mint)}
              </td>
              <td className="px-5 py-3 align-middle text-right tabular-nums">
                {fmtUsd(b.ui_amount)}
              </td>
              <td className="px-5 py-3 align-middle text-right">
                <span className="text-foreground-muted text-[0.7rem]">Not Deposited</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Portfolio() {
  const {
    walletAddress,
    activeType,
    setActiveType,
    filterMode,
    setFilterMode,
    chartPeriod,
    setChartPeriod,
    positionsQuery,
    historyQuery,
    positions,
    byType,
    byProtocol,
    visiblePositions,
    summary,
    stableSummary,
    diversification,
    chartData,
    showSyncing,
    isRefreshing,
    shortAddr,
  } = usePortfolioData();

  const [chartMetric, setChartMetric] = useState<ChartMetric>("value");
  const posColToggle = usePositionColumnToggle();

  const allColumns = useMemo(() => getColumnsForType(activeType), [activeType]);
  const columns = useMemo(
    () => allColumns.filter((col) => {
      const key = HEADER_TO_COL_KEY[col.header];
      if (!key) return true;
      return posColToggle.visibleColumns.includes(key);
    }),
    [allColumns, posColToggle.visibleColumns],
  );

  const handleIdleClick = () => {
    setFilterMode("strategy");
    setActiveType("idle");
    document.getElementById("positions")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-8 lg:px-[3.5rem] py-[2.25rem]">
      {!walletAddress && <NoWalletState />}

      {walletAddress && positionsQuery.isLoading && <LoadingSkeleton />}

      {walletAddress && positionsQuery.isError && <ErrorState />}

      {walletAddress && positionsQuery.isSuccess && (
        <>
          <div className="mb-[2.25rem]">
            <h1 className="font-display text-2xl tracking-[-0.02em]">Portfolio</h1>
            <p className="text-foreground-muted font-sans text-[0.8rem] mt-1">
              {shortAddr}
              {isRefreshing && <span className="ml-2 text-neon-primary animate-pulse">Refreshing...</span>}
            </p>
          </div>

          {/* Stats: Row 1 = overview, Row 2 = performance */}
          <StatsGrid
            stats={[
              { label: "Net Value", value: fmtUsd(summary.total_value_usd) },
              { label: "Allocated", value: fmtUsd(stableSummary.allocated_usd), sub: `${stableSummary.allocation_pct.toFixed(0)}% deployed` },
              { label: "Not Deposited", value: fmtUsd(stableSummary.idle_usd), onClick: stableSummary.idle_balances.length > 0 ? handleIdleClick : undefined },
              { label: "Positions", value: `${summary.position_count}` },
              { label: "Proj. Yield/yr", value: fmtUsd(summary.projected_yield_yearly_usd), colorClass: pnlColor(summary.projected_yield_yearly_usd) },
              { label: "PnL ($)", value: fmtUsd(summary.total_pnl_usd), colorClass: pnlColor(summary.total_pnl_usd) },
              { label: "ROI", value: fmtPct(summary.roi_pct), colorClass: pnlColor(summary.roi_pct) },
              { label: "Market APY", value: fmtApy(summary.weighted_apy), colorClass: pnlColor(summary.weighted_apy), tooltip: "Weighted average APY currently offered by protocols across your positions" },
              { label: "Your APY", value: fmtApy(summary.weighted_apy_realized), colorClass: pnlColor(summary.weighted_apy_realized), tooltip: "Your actual annualized return based on PnL and time held" },
              { label: "Deployed APY", value: fmtApy(stableSummary.apy_allocated), colorClass: pnlColor(stableSummary.apy_allocated), tooltip: "APY calculated on deposited capital only, excluding idle stablecoins" },
            ]}
            size="lg"
            columns="grid-cols-2 sm:grid-cols-5"
            className="mb-[2.25rem]"
          />

          <ChartCard
            chartData={chartData}
            period={chartPeriod}
            onPeriod={setChartPeriod}
            metric={chartMetric}
            onMetric={setChartMetric}
            isSuccess={historyQuery.isSuccess}
          />

          {diversification && <DiversificationSection data={diversification} />}

          {showSyncing && <SyncingState />}

          {!showSyncing && (
            <>
            <div id="positions" className="flex items-center justify-between mb-3">
              <h2 className="font-display text-sm uppercase tracking-[0.03em]">Positions</h2>
              {activeType !== "idle" && (
                <div className="hidden lg:block">
                  <ColumnToggle
                    visibleColumns={posColToggle.visibleColumns}
                    allColumns={posColToggle.allColumns}
                    requiredColumns={posColToggle.requiredColumns}
                    labels={POSITION_COLUMN_LABELS}
                    toggleColumn={posColToggle.toggleColumn}
                    resetColumns={posColToggle.resetColumns}
                  />
                </div>
              )}
            </div>
            <div className="flex flex-col lg:flex-row rounded-sm overflow-hidden mb-[2.25rem]">
              <PositionSidebar
                filterMode={filterMode}
                setFilterMode={setFilterMode}
                byType={byType}
                byProtocol={byProtocol}
                totalCount={positions.length}
                idleCount={stableSummary.idle_balances.length}
                activeFilter={activeType}
                onSelect={setActiveType}
              />
              {activeType === "idle"
                ? <IdleTokensTable balances={stableSummary.idle_balances} />
                : <PositionTable columns={columns} positions={visiblePositions} activeType={activeType} />
              }
            </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
