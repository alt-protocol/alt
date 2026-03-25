"use client";

import { useRef, useCallback } from "react";
import Dropdown from "@/components/Dropdown";
import { fmtCategory } from "@/lib/format";
import { useClickOutside } from "@/lib/hooks/useClickOutside";
import type { Filters } from "@/lib/hooks/useYieldFilters";

const CATEGORIES = ["", "lending", "multiply", "insurance_fund", "vault"];
const QUICK_TOKENS = ["USDC"];

const inputClass = "w-full bg-surface text-foreground rounded-sm px-3 py-2 text-[0.8rem] font-sans outline-none focus:bg-surface-high transition-colors placeholder:text-foreground-muted";

interface FilterPanelProps {
  filters: Filters;
  draftFilters: Filters;
  setDraftFilters: (f: Filters) => void;
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  activeFilterCount: number;
  sources: string[];
  allTokens: string[];
  updateFilters: (f: Filters) => void;
  applyFilters: () => void;
  resetFilters: () => void;
}

export default function FilterPanel({
  filters,
  draftFilters,
  setDraftFilters,
  filterOpen,
  setFilterOpen,
  activeFilterCount,
  sources,
  allTokens,
  updateFilters,
  applyFilters,
  resetFilters,
}: FilterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const closePanel = useCallback(() => setFilterOpen(false), [setFilterOpen]);
  useClickOutside(panelRef, filterOpen, closePanel);

  const protocolOptions = [{ value: "", label: "All Protocols" }, ...sources.map((s) => ({ value: s, label: s }))];
  const tokenOptions = [{ value: "", label: "All Tokens" }, ...allTokens.map((t) => ({ value: t, label: t }))];
  const categoryOptions = [{ value: "", label: "All Categories" }, ...CATEGORIES.filter(Boolean).map((c) => ({ value: c, label: fmtCategory(c) }))];

  return (
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

      {/* Filter chips + filter button */}
      <div className="flex items-center gap-2 flex-wrap justify-end">
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
            onClick={() => updateFilters({ protocol: "", category: "", token: "", apyMin: "", apyMax: "", apy30dMin: "", apy30dMax: "", tvlMin: "", tvlMax: "", liquidityMin: "", liquidityMax: "" })}
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

          {/* Filter dropdown panel */}
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
                    <input type="number" placeholder="Min" value={draftFilters.apyMin} onChange={(e) => setDraftFilters({ ...draftFilters, apyMin: e.target.value })} className={inputClass} />
                    <span className="text-foreground-muted text-[0.75rem]">&ndash;</span>
                    <input type="number" placeholder="Max" value={draftFilters.apyMax} onChange={(e) => setDraftFilters({ ...draftFilters, apyMax: e.target.value })} className={inputClass} />
                  </div>
                </div>

                {/* 30D APR range */}
                <div className="flex items-center justify-between gap-4">
                  <label className="text-[0.8rem] text-foreground-muted font-sans shrink-0 w-24">30D APR (%)</label>
                  <div className="flex items-center gap-2 flex-1">
                    <input type="number" placeholder="Min" value={draftFilters.apy30dMin} onChange={(e) => setDraftFilters({ ...draftFilters, apy30dMin: e.target.value })} className={inputClass} />
                    <span className="text-foreground-muted text-[0.75rem]">&ndash;</span>
                    <input type="number" placeholder="Max" value={draftFilters.apy30dMax} onChange={(e) => setDraftFilters({ ...draftFilters, apy30dMax: e.target.value })} className={inputClass} />
                  </div>
                </div>

                {/* TVL range */}
                <div className="flex items-center justify-between gap-4">
                  <label className="text-[0.8rem] text-foreground-muted font-sans shrink-0 w-24">TVL ($)</label>
                  <div className="flex items-center gap-2 flex-1">
                    <input type="number" placeholder="Min" value={draftFilters.tvlMin} onChange={(e) => setDraftFilters({ ...draftFilters, tvlMin: e.target.value })} className={inputClass} />
                    <span className="text-foreground-muted text-[0.75rem]">&ndash;</span>
                    <input type="number" placeholder="Max" value={draftFilters.tvlMax} onChange={(e) => setDraftFilters({ ...draftFilters, tvlMax: e.target.value })} className={inputClass} />
                  </div>
                </div>

                {/* Available Liquidity range */}
                <div className="flex items-center justify-between gap-4">
                  <label className="text-[0.8rem] text-foreground-muted font-sans shrink-0 w-24">Avail. Liq. ($)</label>
                  <div className="flex items-center gap-2 flex-1">
                    <input type="number" placeholder="Min" value={draftFilters.liquidityMin} onChange={(e) => setDraftFilters({ ...draftFilters, liquidityMin: e.target.value })} className={inputClass} />
                    <span className="text-foreground-muted text-[0.75rem]">&ndash;</span>
                    <input type="number" placeholder="Max" value={draftFilters.liquidityMax} onChange={(e) => setDraftFilters({ ...draftFilters, liquidityMax: e.target.value })} className={inputClass} />
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
  );
}
