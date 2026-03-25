"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, YieldOpportunity } from "@/lib/api";
import Dropdown from "@/components/Dropdown";

function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null) return "\u2014";
  return n.toFixed(decimals);
}

function fmtTvl(n: number | null | undefined) {
  if (n == null) return "\u2014";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtCategory(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type SortField = "apy" | "tvl" | "apy30d" | "liquidity";
type SortDir = "asc" | "desc";

interface Filters {
  protocol: string;
  category: string;
  token: string;
  apyMin: string;
  apyMax: string;
  apy30dMin: string;
  apy30dMax: string;
  tvlMin: string;
  tvlMax: string;
  liquidityMin: string;
  liquidityMax: string;
}

const EMPTY_FILTERS: Filters = { protocol: "", category: "", token: "", apyMin: "", apyMax: "", apy30dMin: "", apy30dMax: "", tvlMin: "", tvlMax: "", liquidityMin: "", liquidityMax: "" };
const CATEGORIES = ["", "lending", "multiply", "insurance_fund", "vault"];
const QUICK_TOKENS = ["USDC"];

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="max-w-[1200px] mx-auto px-4 sm:px-8 lg:px-[3.5rem] py-[2.25rem]" />}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialFilters = useMemo<Filters>(() => ({
    protocol: searchParams.get("protocol") ?? "",
    category: searchParams.get("category") ?? "",
    token: searchParams.get("token") ?? "",
    apyMin: searchParams.get("apyMin") ?? "",
    apyMax: searchParams.get("apyMax") ?? "",
    apy30dMin: searchParams.get("apy30dMin") ?? "",
    apy30dMax: searchParams.get("apy30dMax") ?? "",
    tvlMin: searchParams.get("tvlMin") ?? "",
    tvlMax: searchParams.get("tvlMax") ?? "",
    liquidityMin: searchParams.get("liquidityMin") ?? "",
    liquidityMax: searchParams.get("liquidityMax") ?? "",
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const initialSortField = useMemo<SortField>(() => {
    const s = searchParams.get("sort");
    return s === "tvl" || s === "apy30d" || s === "liquidity" ? s : "apy";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialSortDir = useMemo<SortDir>(() => {
    const d = searchParams.get("dir");
    return d === "asc" ? "asc" : "desc";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [sortField, setSortField] = useState<SortField>(initialSortField);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [draftFilters, setDraftFilters] = useState<Filters>(initialFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // 30d sort is client-side only; for apy/tvl we use backend sort
  const backendSort = sortField === "apy30d" || sortField === "liquidity" ? "apy_desc" : `${sortField}_${sortDir}`;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["yields", backendSort, filters.category],
    queryFn: () =>
      api.getYields({
        sort: backendSort,
        category: filters.category || undefined,
        stablecoins_only: true,
      }),
  });

  const allYields: YieldOpportunity[] = data?.data ?? [];

  const yields = useMemo(() => {
    let result = allYields;
    if (filters.protocol) result = result.filter((y) => y.protocol_name === filters.protocol);
    if (filters.token) result = result.filter((y) => y.tokens.includes(filters.token));
    const apyMin = filters.apyMin ? parseFloat(filters.apyMin) : null;
    const apyMax = filters.apyMax ? parseFloat(filters.apyMax) : null;
    const apy30dMin = filters.apy30dMin ? parseFloat(filters.apy30dMin) : null;
    const apy30dMax = filters.apy30dMax ? parseFloat(filters.apy30dMax) : null;
    const tvlMin = filters.tvlMin ? parseFloat(filters.tvlMin) : null;
    const tvlMax = filters.tvlMax ? parseFloat(filters.tvlMax) : null;
    if (apyMin != null) result = result.filter((y) => (y.apy_current ?? 0) >= apyMin);
    if (apyMax != null) result = result.filter((y) => (y.apy_current ?? 0) <= apyMax);
    if (apy30dMin != null) result = result.filter((y) => (y.apy_30d_avg ?? 0) >= apy30dMin);
    if (apy30dMax != null) result = result.filter((y) => (y.apy_30d_avg ?? 0) <= apy30dMax);
    if (tvlMin != null) result = result.filter((y) => (y.tvl_usd ?? 0) >= tvlMin);
    if (tvlMax != null) result = result.filter((y) => (y.tvl_usd ?? 0) <= tvlMax);
    const liqMin = filters.liquidityMin ? parseFloat(filters.liquidityMin) : null;
    const liqMax = filters.liquidityMax ? parseFloat(filters.liquidityMax) : null;
    if (liqMin != null) result = result.filter((y) => (y.liquidity_available_usd ?? 0) >= liqMin);
    if (liqMax != null) result = result.filter((y) => (y.liquidity_available_usd ?? 0) <= liqMax);
    // Client-side sort for 30d and liquidity
    if (sortField === "apy30d") {
      result = [...result].sort((a, b) => {
        const av = a.apy_30d_avg ?? 0;
        const bv = b.apy_30d_avg ?? 0;
        return sortDir === "desc" ? bv - av : av - bv;
      });
    }
    if (sortField === "liquidity") {
      result = [...result].sort((a, b) => {
        const av = a.liquidity_available_usd ?? 0;
        const bv = b.liquidity_available_usd ?? 0;
        return sortDir === "desc" ? bv - av : av - bv;
      });
    }
    return result;
  }, [allYields, filters, sortField, sortDir]);

  const sources = useMemo(() => {
    const names = new Set(allYields.map((y) => y.protocol_name).filter(Boolean));
    return Array.from(names).sort() as string[];
  }, [allYields]);

  const allTokens = useMemo(() => {
    const tokens = new Set(allYields.flatMap((y) => y.tokens).filter(Boolean));
    return Array.from(tokens).sort();
  }, [allYields]);

  // Close filter panel on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    if (filterOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [filterOpen]);

  function updateFilters(f: Filters) {
    setFilters(f);
    syncToUrl(f, sortField, sortDir);
  }

  function syncToUrl(f: Filters, sf: SortField, sd: SortDir) {
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
    if (sf !== "apy") params.set("sort", sf);
    if (sd !== "desc") params.set("dir", sd);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "/dashboard", { scroll: false });
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      const newDir = sortDir === "desc" ? "asc" : "desc";
      setSortDir(newDir);
      syncToUrl(filters, field, newDir);
    } else {
      setSortField(field);
      setSortDir("desc");
      syncToUrl(filters, field, "desc");
    }
  }

  function SortArrow({ field }: { field: SortField }) {
    const active = sortField === field;
    const arrow = active && sortDir === "asc" ? "\u2191" : "\u2193";
    return <span className={`ml-1 inline-block w-3 text-center ${active ? "text-foreground" : "text-transparent"}`}>{arrow}</span>;
  }

  function applyFilters() {
    setFilters(draftFilters);
    setFilterOpen(false);
    syncToUrl(draftFilters, sortField, sortDir);
  }

  function resetFilters() {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setFilterOpen(false);
    syncToUrl(EMPTY_FILTERS, sortField, sortDir);
  }

  const activeFilterCount = [filters.protocol, filters.category, filters.token, filters.apyMin, filters.apyMax, filters.apy30dMin, filters.apy30dMax, filters.tvlMin, filters.tvlMax, filters.liquidityMin, filters.liquidityMax].filter(Boolean).length;

  const protocolOptions = [{ value: "", label: "All Protocols" }, ...sources.map((s) => ({ value: s, label: s }))];
  const tokenOptions = [{ value: "", label: "All Tokens" }, ...allTokens.map((t) => ({ value: t, label: t }))];
  const categoryOptions = [{ value: "", label: "All Categories" }, ...CATEGORIES.filter(Boolean).map((c) => ({ value: c, label: fmtCategory(c) }))];

  const inputClass = "w-full bg-surface text-foreground rounded-sm px-3 py-2 text-[0.8rem] font-sans outline-none focus:bg-surface-high transition-colors placeholder:text-foreground-muted";

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-8 lg:px-[3.5rem] py-[2.25rem]">
      {/* Hero */}
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

      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[1px] bg-outline-ghost rounded-sm overflow-hidden mb-[2.25rem]">
        {[
          { label: "Protocols", value: `${sources.length || "\u2014"}`, sub: "integrated" },
          { label: "Categories", value: `${new Set(allYields.map(y => y.category)).size || "\u2014"}`, sub: "types" },
          { label: "Opportunities", value: `${allYields.length || "\u2014"}`, sub: "active" },
          { label: "Top APR", value: allYields[0] ? `${fmt(allYields[0].apy_current, 1)}%` : "\u2014", sub: allYields[0]?.tokens[0] ?? "" },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface-low px-5 py-4">
            <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">{stat.label}</p>
            <p className="font-display text-xl tracking-[-0.02em]">
              {stat.value} <span className="text-foreground-muted text-[0.75rem] font-sans">{stat.sub}</span>
            </p>
          </div>
        ))}
      </div>

      {/* Yield Marketplace */}
      <div className="bg-surface-low rounded-sm overflow-hidden">
        <div className="px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-5">
            <h2 className="font-display text-sm uppercase tracking-[0.03em] shrink-0">Yield Marketplace</h2>
            {QUICK_TOKENS.map((t) => (
              <button
                key={t}
                onClick={() => updateFilters({ ...filters, token: filters.token === t ? "" : t })}
                className={`text-[0.7rem] font-sans rounded-sm px-3 py-1 transition-colors ${
                  filters.token === t
                    ? "bg-white text-[#243600] font-semibold"
                    : "border border-outline-ghost text-foreground-muted hover:text-foreground hover:border-foreground-muted"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Filter chips + filter button — right side */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Active filter chips */}
            {filters.protocol && (
              <span className="flex items-center gap-1.5 bg-surface-high text-foreground text-[0.7rem] font-sans rounded-sm px-2.5 py-1 hover:bg-secondary hover:text-secondary-text transition-colors cursor-default">
                {filters.protocol}
                <button onClick={() => updateFilters({ ...filters, protocol: "" })} className="text-foreground-muted hover:text-foreground transition-colors leading-none">&times;</button>
              </span>
            )}
            {filters.token && (
              <span className="flex items-center gap-1.5 bg-surface-high text-foreground text-[0.7rem] font-sans rounded-sm px-2.5 py-1 hover:bg-secondary hover:text-secondary-text transition-colors cursor-default">
                {filters.token}
                <button onClick={() => updateFilters({ ...filters, token: "" })} className="text-foreground-muted hover:text-foreground transition-colors leading-none">&times;</button>
              </span>
            )}
            {filters.category && (
              <span className="flex items-center gap-1.5 bg-surface-high text-foreground text-[0.7rem] font-sans rounded-sm px-2.5 py-1 hover:bg-secondary hover:text-secondary-text transition-colors cursor-default">
                {fmtCategory(filters.category)}
                <button onClick={() => updateFilters({ ...filters, category: "" })} className="text-foreground-muted hover:text-foreground transition-colors leading-none">&times;</button>
              </span>
            )}
            {(filters.apyMin || filters.apyMax) && (
              <span className="flex items-center gap-1.5 bg-surface-high text-foreground text-[0.7rem] font-sans rounded-sm px-2.5 py-1 hover:bg-secondary hover:text-secondary-text transition-colors cursor-default">
                APR: {filters.apyMin || "0"}% – {filters.apyMax || "\u221e"}%
                <button onClick={() => updateFilters({ ...filters, apyMin: "", apyMax: "" })} className="text-foreground-muted hover:text-foreground transition-colors leading-none">&times;</button>
              </span>
            )}
            {(filters.apy30dMin || filters.apy30dMax) && (
              <span className="flex items-center gap-1.5 bg-surface-high text-foreground text-[0.7rem] font-sans rounded-sm px-2.5 py-1 hover:bg-secondary hover:text-secondary-text transition-colors cursor-default">
                30D APR: {filters.apy30dMin || "0"}% – {filters.apy30dMax || "\u221e"}%
                <button onClick={() => updateFilters({ ...filters, apy30dMin: "", apy30dMax: "" })} className="text-foreground-muted hover:text-foreground transition-colors leading-none">&times;</button>
              </span>
            )}
            {(filters.tvlMin || filters.tvlMax) && (
              <span className="flex items-center gap-1.5 bg-surface-high text-foreground text-[0.7rem] font-sans rounded-sm px-2.5 py-1 hover:bg-secondary hover:text-secondary-text transition-colors cursor-default">
                TVL: ${filters.tvlMin || "0"} – ${filters.tvlMax || "\u221e"}
                <button onClick={() => updateFilters({ ...filters, tvlMin: "", tvlMax: "" })} className="text-foreground-muted hover:text-foreground transition-colors leading-none">&times;</button>
              </span>
            )}
            {(filters.liquidityMin || filters.liquidityMax) && (
              <span className="flex items-center gap-1.5 bg-surface-high text-foreground text-[0.7rem] font-sans rounded-sm px-2.5 py-1 hover:bg-secondary hover:text-secondary-text transition-colors cursor-default">
                Liq: ${filters.liquidityMin || "0"} – ${filters.liquidityMax || "\u221e"}
                <button onClick={() => updateFilters({ ...filters, liquidityMin: "", liquidityMax: "" })} className="text-foreground-muted hover:text-foreground transition-colors leading-none">&times;</button>
              </span>
            )}
            {activeFilterCount > 0 && (
              <button
                onClick={() => updateFilters(EMPTY_FILTERS)}
                className="text-foreground-muted hover:text-foreground text-[0.7rem] font-sans transition-colors"
              >
                Clear all
              </button>
            )}

            {/* Filter button */}
          <div className="relative" ref={panelRef}>
            <button
              onClick={() => { setDraftFilters(filters); setFilterOpen(!filterOpen); }}
              className={`flex items-center gap-2 text-[0.75rem] font-sans rounded-sm px-3 py-1.5 transition-colors border ${
                activeFilterCount > 0
                  ? "border-neon text-neon"
                  : "border-outline-ghost text-foreground-muted hover:text-foreground hover:border-foreground-muted"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span className="bg-neon text-on-neon text-[0.6rem] font-semibold rounded-sm px-1.5 py-0.5 leading-none">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Filter panel */}
            {filterOpen && (
              <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-[380px] bg-surface-low rounded-sm z-50" style={{ boxShadow: "0 10px 40px rgba(0,0,0,0.4)" }}>
                {/* Header */}
                <div className="px-5 pt-5 pb-3 flex items-center justify-between">
                  <h3 className="font-display text-base tracking-[-0.01em]">Filters</h3>
                  <button
                    onClick={() => setFilterOpen(false)}
                    className="text-foreground-muted hover:text-foreground transition-colors text-lg leading-none"
                  >
                    &times;
                  </button>
                </div>

                <div className="px-5 space-y-4 pb-2">
                  {/* Protocol */}
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-[0.8rem] text-foreground-muted font-sans shrink-0 w-24">Protocol</label>
                    <Dropdown
                      value={draftFilters.protocol}
                      options={protocolOptions}
                      onChange={(v) => setDraftFilters({ ...draftFilters, protocol: v })}
                      placeholder="All Protocols"
                    />
                  </div>

                  {/* Token */}
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-[0.8rem] text-foreground-muted font-sans shrink-0 w-24">Token</label>
                    <Dropdown
                      value={draftFilters.token}
                      options={tokenOptions}
                      onChange={(v) => setDraftFilters({ ...draftFilters, token: v })}
                      placeholder="All Tokens"
                    />
                  </div>

                  {/* Category */}
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-[0.8rem] text-foreground-muted font-sans shrink-0 w-24">Category</label>
                    <Dropdown
                      value={draftFilters.category}
                      options={categoryOptions}
                      onChange={(v) => setDraftFilters({ ...draftFilters, category: v })}
                      placeholder="All Categories"
                    />
                  </div>

                  {/* APR range */}
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-[0.8rem] text-foreground-muted font-sans shrink-0 w-24">APR (%)</label>
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="number"
                        placeholder="Min"
                        value={draftFilters.apyMin}
                        onChange={(e) => setDraftFilters({ ...draftFilters, apyMin: e.target.value })}
                        className={inputClass}
                      />
                      <span className="text-foreground-muted text-[0.75rem]">&ndash;</span>
                      <input
                        type="number"
                        placeholder="Max"
                        value={draftFilters.apyMax}
                        onChange={(e) => setDraftFilters({ ...draftFilters, apyMax: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  {/* 30D APR range */}
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-[0.8rem] text-foreground-muted font-sans shrink-0 w-24">30D APR (%)</label>
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="number"
                        placeholder="Min"
                        value={draftFilters.apy30dMin}
                        onChange={(e) => setDraftFilters({ ...draftFilters, apy30dMin: e.target.value })}
                        className={inputClass}
                      />
                      <span className="text-foreground-muted text-[0.75rem]">&ndash;</span>
                      <input
                        type="number"
                        placeholder="Max"
                        value={draftFilters.apy30dMax}
                        onChange={(e) => setDraftFilters({ ...draftFilters, apy30dMax: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  {/* TVL range */}
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-[0.8rem] text-foreground-muted font-sans shrink-0 w-24">TVL ($)</label>
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="number"
                        placeholder="Min"
                        value={draftFilters.tvlMin}
                        onChange={(e) => setDraftFilters({ ...draftFilters, tvlMin: e.target.value })}
                        className={inputClass}
                      />
                      <span className="text-foreground-muted text-[0.75rem]">&ndash;</span>
                      <input
                        type="number"
                        placeholder="Max"
                        value={draftFilters.tvlMax}
                        onChange={(e) => setDraftFilters({ ...draftFilters, tvlMax: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  {/* Available Liquidity range */}
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-[0.8rem] text-foreground-muted font-sans shrink-0 w-24">Avail. Liq. ($)</label>
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="number"
                        placeholder="Min"
                        value={draftFilters.liquidityMin}
                        onChange={(e) => setDraftFilters({ ...draftFilters, liquidityMin: e.target.value })}
                        className={inputClass}
                      />
                      <span className="text-foreground-muted text-[0.75rem]">&ndash;</span>
                      <input
                        type="number"
                        placeholder="Max"
                        value={draftFilters.liquidityMax}
                        onChange={(e) => setDraftFilters({ ...draftFilters, liquidityMax: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-4 flex items-center justify-between">
                  <button
                    onClick={resetFilters}
                    className="text-foreground-muted hover:text-foreground text-[0.8rem] font-sans transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    onClick={applyFilters}
                    className="bg-neon text-on-neon rounded-sm px-5 py-2 text-[0.8rem] font-semibold font-sans hover:bg-neon-bright transition-colors"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>
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
                      <span className="ml-2 text-[0.65rem] text-foreground-muted font-sans">{y.tokens.join(", ")}</span>
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
                        <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Available Liquidity</span>
                        <span className="text-[0.8rem] font-sans tabular-nums text-foreground-muted">{y.liquidity_available_usd != null ? fmtTvl(y.liquidity_available_usd) : "\u2014"}</span>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">APR</span>
                        <span className="text-[0.8rem] font-sans tabular-nums text-neon font-semibold">{fmt(y.apy_current)}%</span>
                      </div>
                      <div className="flex justify-between items-baseline">
                        <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">30D APR</span>
                        <span className="text-[0.8rem] font-sans tabular-nums text-foreground-muted">{y.apy_30d_avg != null ? `${fmt(y.apy_30d_avg)}%` : "\u2014"}</span>
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
                    <th
                      className="text-right px-5 py-2.5 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                      onClick={() => toggleSort("tvl")}
                    >
                      TVL<SortArrow field="tvl" />
                    </th>
                    <th
                      className="text-right px-5 py-2.5 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                      onClick={() => toggleSort("liquidity")}
                    >
                      Available Liquidity<SortArrow field="liquidity" />
                    </th>
                    <th
                      className="text-right px-5 py-2.5 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                      onClick={() => toggleSort("apy")}
                    >
                      APR<SortArrow field="apy" />
                    </th>
                    <th
                      className="text-right px-5 py-2.5 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                      onClick={() => toggleSort("apy30d")}
                    >
                      30D APR<SortArrow field="apy30d" />
                    </th>
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
                          <span className="ml-2 text-[0.65rem] text-foreground-muted">{y.tokens.join(", ")}</span>
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
                      <td className="px-5 py-3 text-right text-foreground-muted tabular-nums">{fmtTvl(y.tvl_usd)}</td>
                      <td className="px-5 py-3 text-right text-foreground-muted tabular-nums">{y.liquidity_available_usd != null ? fmtTvl(y.liquidity_available_usd) : "\u2014"}</td>
                      <td className="px-5 py-3 text-right font-semibold text-neon tabular-nums">
                        {fmt(y.apy_current)}%
                      </td>
                      <td className="px-5 py-3 text-right text-foreground-muted tabular-nums">
                        {y.apy_30d_avg != null ? `${fmt(y.apy_30d_avg)}%` : "\u2014"}
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
            <div className="px-5 py-3 text-center">
              <p className="text-foreground-muted text-[0.7rem] font-sans">
                {yields.length} opportunities &middot; {data?.meta?.last_updated
                  ? `Updated ${new Date(data.meta.last_updated).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                  : ""}
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
