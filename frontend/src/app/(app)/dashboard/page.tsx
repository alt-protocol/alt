"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Suspense, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api, YieldOpportunity } from "@/lib/api";
import { fmtNum, fmtTvl, fmtCategory, fmtPriceRange, fmtSpread, fmtShieldWarning } from "@/lib/format";
import { useYieldFilters, type SortField } from "@/lib/hooks/useYieldFilters";
import { queryKeys } from "@/lib/queryKeys";
import FilterPanel from "@/components/FilterPanel";
import StatsGrid from "@/components/StatsGrid";
/** Format snapshot count as approximate time span (15-min intervals) */
function fmtPegSpan(snapshots: number): string {
  const hours = Math.round(snapshots * 15 / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function SortArrow({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: "asc" | "desc" }) {
  const active = sortField === field;
  const arrow = active && sortDir === "asc" ? "\u2191" : "\u2193";
  return <span className={`ml-1 inline-block w-3 text-center ${active ? "text-foreground" : "text-transparent"}`}>{arrow}</span>;
}

function DashboardSkeleton() {
  return (
    <>
      {/* Stats skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[1px] bg-outline-ghost rounded-sm overflow-hidden mb-[2.25rem]">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-surface-low px-5 py-4">
            <div className="bg-surface-high animate-pulse rounded-sm h-3 w-16 mb-2" />
            <div className="bg-surface-high animate-pulse rounded-sm h-7 w-24" />
          </div>
        ))}
      </div>
      {/* Table skeleton */}
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
      {/* Hero — renders immediately, no data dependency */}
      <div className="mb-[2.25rem]">
        <p className="inline-block bg-neon text-on-neon text-[0.65rem] uppercase tracking-[0.08em] font-semibold rounded-sm px-2.5 py-1 mb-4">
          Solana Yield Aggregator
        </p>
        <h1 className="font-brand text-[2rem] sm:text-[2.75rem] lg:text-[3.5rem] leading-[1.05] tracking-[-0.02em]">
          DISCOVER<br />
          <span className="text-neon">YIELD</span>
        </h1>
        <p className="text-foreground-muted font-sans text-[0.875rem] mt-4 max-w-lg leading-relaxed">
          High-fidelity liquidity management and automated yield strategies for
          institutional-grade DeFi assets. Built on high-throughput architecture.
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
  const router = useRouter();

  // Unfiltered query — for dropdown options + stats (cached long)
  const optionsQuery = useQuery({
    queryKey: queryKeys.yields.all,
    queryFn: () => api.getYields({ asset_class: "stablecoin", limit: 500 }),
    staleTime: 60_000,
  });
  const optionsData: YieldOpportunity[] = optionsQuery.data?.data ?? [];

  // Hook manages filter/sort/offset state and builds backend params
  const f = useYieldFilters(optionsData);

  // Filtered + paginated query — for table display
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

  // Client-side post-processing (30d filter + 30d/liquidity sort)
  const { processPage } = f;
  const yields = useMemo(() => processPage(data?.data ?? []), [data?.data, processPage]);
  const total = data?.meta?.total ?? 0;

  const topYield = optionsData.reduce<YieldOpportunity | null>(
    (best, y) => (y.apy_current ?? 0) > (best?.apy_current ?? 0) ? y : best,
    null
  );

  return (
    <>
      {/* Stats Bar */}
      <StatsGrid
        stats={[
          { label: "Protocols", value: `${f.sources.length || "\u2014"}`, sub: "integrated" },
          { label: "Categories", value: `${new Set(optionsData.map(y => y.category)).size || "\u2014"}`, sub: "types" },
          { label: "Opportunities", value: `${optionsData.length || "\u2014"}`, sub: "active" },
          { label: "Top APR", value: topYield ? `${fmtNum(topYield.apy_current, 1)}%` : "\u2014", sub: topYield?.tokens[0] ?? "" },
        ]}
        columns="grid-cols-2 sm:grid-cols-4"
        className="mb-[2.25rem]"
      />

      {/* Yield Marketplace */}
      <div className="bg-surface-low rounded-sm overflow-hidden">
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
            {/* Mobile cards */}
            <div className="lg:hidden space-y-2 px-3 py-4">
              {yields.map((y) => {
                const displayName = y.name
                  .replace(new RegExp(`^${y.protocol_name}\\s*`, "i"), "")
                  .replace(new RegExp(`\\b${fmtCategory(y.category)}\\b\\s*[-—]?\\s*`, "i"), "")
                  .replace(/^(Lend|Earn|Borrow|Stake)\s*[-—]\s*/i, "")
                  .replace(/^[-—]\s*/, "")
                  .trim() || y.name;
                return (
                  <div
                    key={y.id}
                    className="bg-surface rounded-sm p-4 space-y-3 cursor-pointer active:bg-surface-high transition-colors"
                    onClick={() => router.push(`/yields/${y.id}`)}
                  >
                    <div>
                      <span className="font-display text-sm tracking-[-0.02em]">{displayName}</span>
                      <span className="ml-2 text-[0.65rem] text-foreground-muted font-sans">{y.tokens.join(", ")}{y.underlying_tokens?.[0]?.type ? ` · ${y.underlying_tokens[0].type.replace(/_/g, " ")}` : ""}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block bg-secondary text-secondary-text rounded-sm px-2.5 py-0.5 text-[0.6rem] tracking-[0.03em] font-medium">
                        {y.protocol_name ?? "\u2014"}
                      </span>
                      <span className="text-[0.65rem] text-foreground-muted font-sans">{fmtCategory(y.category)}</span>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-baseline">
                        <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">TVL</span>
                        <span className="text-[0.8rem] font-sans tabular-nums text-foreground-muted">{fmtTvl(y.tvl_usd)}</span>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Liquidity</span>
                        <span className="text-[0.8rem] font-sans tabular-nums text-foreground-muted">{fmtTvl(y.liquidity_available_usd)}</span>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">APR</span>
                        <span className="text-[0.8rem] font-sans tabular-nums text-neon font-semibold">{fmtNum(y.apy_current)}%</span>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">30D APR</span>
                        <span className="text-[0.8rem] font-sans tabular-nums text-foreground-muted">{y.apy_30d_avg != null ? `${fmtNum(y.apy_30d_avg)}%` : "\u2014"}</span>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Risk</span>
                        <span className="text-[0.8rem] font-sans tabular-nums text-foreground-muted text-right">
                          {y.peg_stability && y.peg_stability.snapshot_count_7d >= 2 ? (
                            <>
                              {fmtPriceRange(y.peg_stability.min_price_7d, y.peg_stability.max_price_7d)} · {fmtSpread(y.peg_stability.min_price_7d, y.peg_stability.max_price_7d)} · {fmtPegSpan(y.peg_stability.snapshot_count_7d)}
                              {y.peg_stability.liquidity_usd != null && ` · ${fmtTvl(y.peg_stability.liquidity_usd)} liq`}
                              {y.lock_period_days > 0 && ` · ${y.lock_period_days}d lock`}
                            </>
                          ) : y.lock_period_days > 0 ? (
                            `${y.lock_period_days}d lock`
                          ) : "\u2014"}
                          {y.token_warnings && y.token_warnings.length > 0 && (
                            <span
                              className={`ml-1 ${y.token_warnings.some(w => w.severity === "warning") ? "text-yellow-400" : "text-foreground-muted"}`}
                              title={y.token_warnings.map(w => `${fmtShieldWarning(w.type)}: ${w.message}`).join("\n")}
                            >
                              · {y.token_warnings.length} {y.token_warnings.length === 1 ? "warning" : "warnings"}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <button
                      className="w-full border border-secondary text-secondary-text text-[0.7rem] rounded-sm px-4 py-2 hover:bg-secondary hover:text-foreground transition-colors font-sans"
                      onClick={(e) => { e.stopPropagation(); router.push(`/yields/${y.id}`); }}
                    >
                      Details
                    </button>
                  </div>
                );
              })}
            </div>
            {/* Desktop table */}
            <div className="hidden lg:block">
              <table className="w-full text-[0.8rem] font-sans">
                <thead>
                  <tr className="text-foreground-muted uppercase text-[0.6rem] tracking-[0.05em] bg-surface">
                    <th className="text-left px-5 py-2.5 font-medium">Name</th>
                    <th className="text-left px-5 py-2.5 font-medium">Protocol</th>
                    <th className="text-left px-5 py-2.5 font-medium">Category</th>
                    <th className="text-left px-5 py-2.5 font-medium">Tokens</th>
                    <th
                      className="text-right px-5 py-2.5 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                      onClick={() => f.toggleSort("tvl")}
                    >
                      TVL<SortArrow sortField={f.sortField} sortDir={f.sortDir} field="tvl" />
                    </th>
                    <th
                      className="text-right px-5 py-2.5 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                      onClick={() => f.toggleSort("liquidity")}
                    >
                      Liquidity<SortArrow sortField={f.sortField} sortDir={f.sortDir} field="liquidity" />
                    </th>
                    <th
                      className="text-right px-5 py-2.5 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                      onClick={() => f.toggleSort("apy")}
                    >
                      APR<SortArrow sortField={f.sortField} sortDir={f.sortDir} field="apy" />
                    </th>
                    <th
                      className="text-right px-5 py-2.5 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                      onClick={() => f.toggleSort("apy30d")}
                    >
                      30D APR<SortArrow sortField={f.sortField} sortDir={f.sortDir} field="apy30d" />
                    </th>
                    <th className="text-right px-5 py-2.5 font-medium whitespace-nowrap">Risk</th>
                    <th className="text-right px-5 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {yields.map((y) => (
                    <tr
                      key={y.id}
                      className="hover:bg-surface-high transition-colors cursor-pointer"
                      onClick={() => router.push(`/yields/${y.id}`)}
                    >
                      <td className="px-5 py-3">
                        <div>
                          <span className="font-medium text-foreground">
                            {y.name
                              .replace(new RegExp(`^${y.protocol_name}\\s*`, "i"), "")
                              .replace(new RegExp(`\\b${fmtCategory(y.category)}\\b\\s*[-—]?\\s*`, "i"), "")
                              .replace(/^(Lend|Earn|Borrow|Stake)\s*[-—]\s*/i, "")
                              .replace(/^[-—]\s*/, "")
                              .trim() || y.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-block bg-secondary text-secondary-text rounded-sm px-2.5 py-0.5 text-[0.65rem] tracking-[0.03em] font-medium">
                          {y.protocol_name ?? "\u2014"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-foreground-muted">
                        {fmtCategory(y.category)}
                      </td>
                      <td className="px-5 py-3 text-foreground-muted">
                        {y.underlying_tokens?.map((t) => t.symbol).join(", ") ?? y.tokens.join(", ")}
                      </td>
                      <td className="px-5 py-3 text-right text-foreground-muted tabular-nums">{fmtTvl(y.tvl_usd)}</td>
                      <td className="px-5 py-3 text-right text-foreground-muted tabular-nums">{fmtTvl(y.liquidity_available_usd)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-neon tabular-nums">
                        {fmtNum(y.apy_current)}%
                      </td>
                      <td className="px-5 py-3 text-right text-foreground-muted tabular-nums">
                        {y.apy_30d_avg != null ? `${fmtNum(y.apy_30d_avg)}%` : "\u2014"}
                      </td>
                      <td className="px-5 py-3 text-right text-foreground-muted text-[0.7rem] leading-relaxed">
                        {y.peg_stability && y.peg_stability.snapshot_count_7d >= 2 ? (
                          <>
                            <div>
                              {fmtPriceRange(y.peg_stability.min_price_7d, y.peg_stability.max_price_7d)}{" · "}{fmtSpread(y.peg_stability.min_price_7d, y.peg_stability.max_price_7d)}{" · "}{fmtPegSpan(y.peg_stability.snapshot_count_7d)}
                            </div>
                            <div className="text-foreground-muted">
                              {y.peg_stability.liquidity_usd != null
                                ? `${fmtTvl(y.peg_stability.liquidity_usd)} liq`
                                : "\u2014"}
                              {y.lock_period_days > 0 && ` · ${y.lock_period_days}d lock`}
                            </div>
                          </>
                        ) : y.lock_period_days > 0 ? (
                          `${y.lock_period_days}d lock`
                        ) : "\u2014"}
                        {y.token_warnings && y.token_warnings.length > 0 && (
                          <div
                            className={`text-[0.65rem] mt-0.5 ${y.token_warnings.some(w => w.severity === "warning") ? "text-yellow-400" : "text-foreground-muted"}`}
                            title={y.token_warnings.map(w => `${fmtShieldWarning(w.type)}: ${w.message}`).join("\n")}
                          >
                            {y.token_warnings.map(w => fmtShieldWarning(w.type)).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          className="border border-secondary text-secondary-text text-[0.7rem] rounded-sm px-4 py-1.5 hover:bg-secondary hover:text-foreground transition-colors font-sans inline-block"
                          onClick={(e) => { e.stopPropagation(); router.push(`/yields/${y.id}`); }}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
