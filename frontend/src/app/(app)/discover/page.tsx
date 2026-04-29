"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Suspense, useMemo } from "react";
import { api, YieldOpportunity } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import { useYieldFilters } from "@/lib/hooks/useYieldFilters";
import { queryKeys } from "@/lib/queryKeys";
import FilterPanel from "@/components/FilterPanel";
import StatsGrid from "@/components/StatsGrid";
import YieldTable from "@/components/YieldTable";
import ColumnToggle from "@/components/ColumnToggle";
import { useColumnToggle, COLUMN_LABELS } from "@/lib/hooks/useColumnToggle";

function DashboardSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[1px] bg-outline-ghost rounded-sm overflow-hidden mb-[2.25rem]">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-surface-low px-5 py-4">
            <div className="bg-surface-high animate-pulse rounded-sm h-3 w-16 mb-2" />
            <div className="bg-surface-high animate-pulse rounded-sm h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="bg-surface-low rounded-sm overflow-hidden">
        <div className="px-5 py-3 flex items-center justify-between">
          <div className="bg-surface-high animate-pulse rounded-sm h-4 w-32" />
          <div className="bg-surface-high animate-pulse rounded-sm h-8 w-20" />
        </div>
        <div className="px-5 py-8 space-y-0">
          <div className="bg-surface h-10" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4 px-0 py-3">
              <div className="bg-surface-high animate-pulse rounded-sm h-4 flex-[2]" />
              <div className="bg-surface-high animate-pulse rounded-sm h-4 w-20" />
              <div className="bg-surface-high animate-pulse rounded-sm h-4 w-24" />
              <div className="bg-surface-high animate-pulse rounded-sm h-4 w-20" />
              <div className="bg-surface-high animate-pulse rounded-sm h-4 w-16" />
              <div className="bg-surface-high animate-pulse rounded-sm h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function Dashboard() {
  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-8 lg:px-[3.5rem] py-[2.25rem]">
      <div className="mb-[2.25rem]">
        <p className="inline-block bg-neon text-on-neon text-[0.65rem] uppercase tracking-[0.08em] font-semibold rounded-sm px-2.5 py-1 mb-4">
          Beta
        </p>
        <h1 className="font-brand text-[2rem] sm:text-[2.75rem] lg:text-[3.5rem] leading-[1.05] tracking-[-0.02em]">
          SOLANA STABLECOIN<br />
          <span className="text-neon">PLATFORM</span>
        </h1>
        <p className="text-foreground-muted font-sans text-[0.875rem] mt-4 max-w-lg leading-relaxed">
          Discover, manage, and monitor stablecoins on Solana.
        </p>
      </div>

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </main>
  );
}

const PAGE_SIZE = 50;

function DashboardContent() {
  const optionsQuery = useQuery({
    queryKey: queryKeys.yields.all,
    queryFn: () => api.getYields({ asset_class: "stablecoin", limit: 500 }),
    staleTime: 60_000,
  });
  const optionsData: YieldOpportunity[] = optionsQuery.data?.data ?? [];

  const f = useYieldFilters(optionsData);
  const colToggle = useColumnToggle();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["yields", "filtered", f.backendSort, f.backendFilters, f.offset],
    queryFn: () => api.getYields({
      asset_class: "stablecoin",
      sort: f.backendSort,
      ...f.backendFilters,
      limit: PAGE_SIZE,
      offset: f.offset,
    }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const { processPage } = f;
  const yields = useMemo(() => processPage(data?.data ?? []), [data?.data, processPage]);
  const total = data?.meta?.total ?? 0;

  const topYield = optionsData.reduce<YieldOpportunity | null>(
    (best, y) => (y.apy_current ?? 0) > (best?.apy_current ?? 0) ? y : best,
    null
  );

  const top30dYield = optionsData.reduce<YieldOpportunity | null>(
    (best, y) => (y.apy_30d_avg ?? 0) > (best?.apy_30d_avg ?? 0) ? y : best,
    null
  );

  return (
    <>
      <StatsGrid
        stats={[
          { label: "Protocols", value: `${f.sources.length || "\u2014"}`, sub: "integrated" },
          { label: "Opportunities", value: `${optionsData.length || "\u2014"}`, sub: "active" },
          { label: "Akashi Fee", value: "0%", sub: "no extra cost" },
          { label: "Top APR", value: topYield ? `${fmtNum(topYield.apy_current, 1)}%` : "\u2014", sub: topYield?.tokens[0] ?? "" },
          { label: "Top 30D APR", value: top30dYield ? `${fmtNum(top30dYield.apy_30d_avg, 1)}%` : "\u2014", sub: top30dYield?.tokens[0] ?? "" },
        ]}
        columns="grid-cols-2 sm:grid-cols-5"
        className="mb-[2.25rem]"
      />

      <div className="bg-surface-low rounded-sm overflow-hidden">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <FilterPanel
              filters={f.filters}
              draftFilters={f.draftFilters}
              setDraftFilters={f.setDraftFilters}
              filterOpen={f.filterOpen}
              setFilterOpen={f.setFilterOpen}
              activeFilterCount={f.activeFilterCount}
              sources={f.sources}
              allTokens={f.allTokens}
              allTokenTypes={f.allTokenTypes}
              updateFilters={f.updateFilters}
              applyFilters={f.applyFilters}
              resetFilters={f.resetFilters}
            />
          </div>
          <div className="pr-5 hidden lg:block">
            <ColumnToggle
              visibleColumns={colToggle.visibleColumns}
              allColumns={colToggle.allColumns}
              requiredColumns={colToggle.requiredColumns}
              labels={COLUMN_LABELS}
              toggleColumn={colToggle.toggleColumn}
              resetColumns={colToggle.resetColumns}
            />
          </div>
        </div>

        {isLoading && (
          <div className="px-5 py-8 space-y-0">
            <div className="bg-surface h-10" />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-4 px-0 py-3">
                <div className="bg-surface-high animate-pulse rounded-sm h-4 flex-[2]" />
                <div className="bg-surface-high animate-pulse rounded-sm h-4 w-20" />
                <div className="bg-surface-high animate-pulse rounded-sm h-4 w-24" />
                <div className="bg-surface-high animate-pulse rounded-sm h-4 w-20" />
                <div className="bg-surface-high animate-pulse rounded-sm h-4 w-16" />
                <div className="bg-surface-high animate-pulse rounded-sm h-4 w-16" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="text-center py-16">
            <p className="text-red-400 font-sans text-sm">Failed to load yields — is the backend running?</p>
            <pre className="mt-2 text-xs text-foreground-muted">{error instanceof Error ? error.message : "Unknown error"}</pre>
          </div>
        )}

        {!isLoading && !isError && yields.length === 0 && (
          <div className="text-center py-16 text-foreground-muted font-sans text-sm">
            No yield data yet. The backend is fetching from DeFiLlama on startup.
          </div>
        )}

        {yields.length > 0 && (
          <>
            <YieldTable
              yields={yields}
              sortField={f.sortField}
              sortDir={f.sortDir}
              toggleSort={f.toggleSort}
              visibleColumns={colToggle.visibleColumns}
            />
            <div className="flex items-center justify-between px-5 py-3 text-[0.75rem] font-sans text-foreground-muted">
              <span>
                {total > 0
                  ? `${f.offset + 1}\u2013${Math.min(f.offset + PAGE_SIZE, total)} of ${total}`
                  : "0 results"}
                {data?.meta?.last_updated && (
                  <> &middot; Updated {new Date(data.meta.last_updated).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</>
                )}
              </span>
              {total > PAGE_SIZE && (
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1 rounded-sm text-[0.7rem] border border-surface-high hover:bg-surface-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => f.setOffset(Math.max(0, f.offset - PAGE_SIZE))}
                    disabled={f.offset === 0}
                  >
                    Previous
                  </button>
                  <button
                    className="px-3 py-1 rounded-sm text-[0.7rem] border border-surface-high hover:bg-surface-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => f.setOffset(f.offset + PAGE_SIZE)}
                    disabled={f.offset + PAGE_SIZE >= total}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
