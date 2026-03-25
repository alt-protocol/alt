"use client";

import dynamic from "next/dynamic";
import { fmtUsd, fmtPct, fmtApy, pnlColor } from "@/lib/format";
import PositionTable, { getColumnsForType } from "@/components/PositionTable";
import StatsGrid from "@/components/StatsGrid";
import PeriodSelector from "@/components/PeriodSelector";
import TabBar from "@/components/TabBar";
import EventsTable from "@/components/EventsTable";
import { LoadingSkeleton, NoWalletState, ErrorState, SyncingState } from "@/components/PortfolioStates";
import RefreshButton from "@/components/RefreshButton";
import { usePortfolioData } from "@/lib/hooks/usePortfolioData";
import { queryKeys } from "@/lib/queryKeys";
import type { ChartPoint } from "@/lib/hooks/usePortfolioData";
import type { UserPositionOut } from "@/lib/api";

const PortfolioChart = dynamic(() => import("@/components/PortfolioChart"), { ssr: false });

const SIDEBAR_TYPES = [
  { key: "all", label: "ALL" },
  { key: "lending", label: "LEND" },
  { key: "multiply", label: "MULTIPLY" },
  { key: "earn_vault", label: "VAULTS" },
  { key: "insurance_fund", label: "INSURANCE FUNDS" },
  { key: "earn", label: "EARN" },
];

interface ChartCardProps {
  chartData: ChartPoint[];
  period: "7d" | "30d" | "90d";
  onPeriod: (p: "7d" | "30d" | "90d") => void;
  isSuccess: boolean;
}

function ChartCard({ chartData, period, onPeriod, isSuccess }: ChartCardProps) {
  return (
    <div className="bg-surface-low rounded-sm mb-[2.25rem]">
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <h2 className="font-display text-sm uppercase tracking-[0.03em]">Net Value</h2>
        <PeriodSelector value={period} onChange={onPeriod} />
      </div>

      {isSuccess && chartData.length === 0 ? (
        <div className="h-[180px] flex items-center justify-center">
          <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans">No history data</p>
        </div>
      ) : (
        <PortfolioChart data={chartData} />
      )}
    </div>
  );
}

interface TypeSidebarProps {
  byType: Record<string, UserPositionOut[]>;
  totalCount: number;
  activeType: string;
  onSelect: (t: string) => void;
}

function TypeSidebar({ byType, totalCount, activeType, onSelect }: TypeSidebarProps) {
  return (
    <div className="w-full lg:w-[200px] shrink-0 bg-surface-low flex lg:flex-col overflow-x-auto">
      {SIDEBAR_TYPES.map(({ key, label }) => {
        const count = key === "all" ? totalCount : (byType[key]?.length ?? 0);
        const isActive = activeType === key;
        return (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className={`flex justify-between items-center gap-2 px-4 py-2.5 text-[0.75rem] font-sans uppercase tracking-[0.05em] transition-colors text-left whitespace-nowrap lg:w-full ${
              isActive ? "text-neon bg-surface-high" : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <span>{label}</span>
            {count > 0 ? (
              <span className="bg-secondary text-secondary-text rounded-sm px-1.5 py-0.5 text-[0.65rem]">{count}</span>
            ) : (
              <span className="text-foreground-muted text-[0.65rem]">0</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function Portfolio() {
  const {
    walletAddress,
    activeTab,
    setActiveTab,
    activeType,
    setActiveType,
    chartPeriod,
    setChartPeriod,
    positionsQuery,
    historyQuery,
    eventsQuery,
    positions,
    byType,
    visiblePositions,
    summary,
    chartData,
    showSyncing,
    shortAddr,
  } = usePortfolioData();

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-8 lg:px-[3.5rem] py-[2.25rem]">
      {!walletAddress && <NoWalletState />}

      {walletAddress && positionsQuery.isLoading && <LoadingSkeleton />}

      {walletAddress && positionsQuery.isError && <ErrorState />}

      {walletAddress && positionsQuery.isSuccess && (
        <>
          <div className="flex items-center gap-3 mb-[2.25rem]">
            <div>
              <h1 className="font-display text-2xl tracking-[-0.02em]">Portfolio</h1>
              <p className="text-foreground-muted font-sans text-[0.8rem] mt-1">{shortAddr}</p>
            </div>
            {walletAddress && (
              <RefreshButton
                queryKeys={[
                  queryKeys.positions.list(walletAddress),
                  ["positionHistory", walletAddress],
                  queryKeys.positions.events(walletAddress),
                  queryKeys.wallet.status(walletAddress),
                ]}
                className="ml-auto"
              />
            )}
          </div>

          <StatsGrid
            stats={[
              { label: "Net Value", value: fmtUsd(summary.totalValue) },
              { label: "PnL ($)", value: fmtUsd(summary.totalPnlUsd), colorClass: pnlColor(summary.totalPnlUsd) },
              { label: "ROI", value: fmtPct(summary.roi), colorClass: pnlColor(summary.roi) },
              { label: "Avg APY", value: fmtApy(summary.weightedApy), colorClass: "text-neon" },
              { label: "Positions", value: `${summary.count}` },
            ]}
            size="lg"
            className="mb-[2.25rem]"
          />

          <ChartCard
            chartData={chartData}
            period={chartPeriod}
            onPeriod={setChartPeriod}
            isSuccess={historyQuery.isSuccess}
          />

          {/* Tab bar */}
          <TabBar
            tabs={[
              { key: "positions", label: "Positions Overview" },
              { key: "history", label: "Transaction History" },
            ]}
            activeKey={activeTab}
            onChange={(k) => setActiveTab(k as "positions" | "history")}
            className="mb-[2.25rem]"
          />

          {showSyncing && <SyncingState />}

          {!showSyncing && activeTab === "positions" && (
            <div className="flex flex-col lg:flex-row rounded-sm overflow-hidden">
              <TypeSidebar
                byType={byType}
                totalCount={positions.length}
                activeType={activeType}
                onSelect={setActiveType}
              />
              <PositionTable columns={getColumnsForType(activeType)} positions={visiblePositions} activeType={activeType} />
            </div>
          )}

          {activeTab === "history" && (
            eventsQuery.isLoading ? (
              <div className="bg-surface-low rounded-sm px-6 py-8 text-center">
                <div className="bg-surface-high animate-pulse rounded-sm h-4 w-48 mx-auto" />
              </div>
            ) : (
              <EventsTable events={eventsQuery.data ?? []} />
            )
          )}
        </>
      )}
    </main>
  );
}
