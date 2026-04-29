"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { YieldOpportunity } from "@/lib/api";

export type SortField = "apy" | "tvl" | "apy30d" | "liquidity";
export type SortDir = "asc" | "desc";

export interface Filters {
  protocol: string;
  category: string;
  token: string;
  tokenType: string;
  apyMin: string;
  apyMax: string;
  apy30dMin: string;
  apy30dMax: string;
  tvlMin: string;
  tvlMax: string;
  liquidityMin: string;
  liquidityMax: string;
}

export const EMPTY_FILTERS: Filters = { protocol: "", category: "", token: "", tokenType: "", apyMin: "", apyMax: "", apy30dMin: "", apy30dMax: "", tvlMin: "", tvlMax: "", liquidityMin: "", liquidityMax: "" };

/** Backend query params built from current filter state */
export interface BackendFilters {
  protocol?: string;
  category?: string;
  tokens?: string;
  token_type?: string;
  apy_min?: number;
  apy_max?: number;
  tvl_min?: number;
  tvl_max?: number;
  liquidity_min?: number;
  liquidity_max?: number;
}

/**
 * Manages filter, sort, and pagination state for the discover page.
 *
 * @param optionsData — full unfiltered dataset for populating dropdown options
 */
export function useYieldFilters(optionsData: YieldOpportunity[]) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialFilters = useMemo<Filters>(() => ({
    protocol: searchParams.get("protocol") ?? "",
    category: searchParams.get("category") ?? "",
    token: searchParams.get("token") ?? "",
    tokenType: searchParams.get("tokenType") ?? "",
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
  const [offset, setOffset] = useState(0);

  // 30d sort is client-side only; for apy/tvl we use backend sort
  const backendSort = sortField === "apy30d" || sortField === "liquidity" ? "apy_desc" : `${sortField}_${sortDir}`;

  // Build backend filter params from current filter state
  const backendFilters = useMemo<BackendFilters>(() => {
    const bf: BackendFilters = {};
    if (filters.protocol) bf.protocol = filters.protocol;
    if (filters.category) bf.category = filters.category;
    if (filters.token) bf.tokens = filters.token;
    if (filters.tokenType) bf.token_type = filters.tokenType;
    const apyMin = filters.apyMin ? parseFloat(filters.apyMin) : undefined;
    const apyMax = filters.apyMax ? parseFloat(filters.apyMax) : undefined;
    const tvlMin = filters.tvlMin ? parseFloat(filters.tvlMin) : undefined;
    const tvlMax = filters.tvlMax ? parseFloat(filters.tvlMax) : undefined;
    const liqMin = filters.liquidityMin ? parseFloat(filters.liquidityMin) : undefined;
    const liqMax = filters.liquidityMax ? parseFloat(filters.liquidityMax) : undefined;
    if (apyMin != null && !isNaN(apyMin)) bf.apy_min = apyMin;
    if (apyMax != null && !isNaN(apyMax)) bf.apy_max = apyMax;
    if (tvlMin != null && !isNaN(tvlMin)) bf.tvl_min = tvlMin;
    if (tvlMax != null && !isNaN(tvlMax)) bf.tvl_max = tvlMax;
    if (liqMin != null && !isNaN(liqMin)) bf.liquidity_min = liqMin;
    if (liqMax != null && !isNaN(liqMax)) bf.liquidity_max = liqMax;
    return bf;
  }, [filters]);

  // Client-side post-processing: 30d range filter + 30d/liquidity sort
  // Applied by the consumer via processPage()
  const processPage = useCallback((pageData: YieldOpportunity[]) => {
    let result = pageData;
    const apy30dMin = filters.apy30dMin ? parseFloat(filters.apy30dMin) : null;
    const apy30dMax = filters.apy30dMax ? parseFloat(filters.apy30dMax) : null;
    if (apy30dMin != null) result = result.filter((y) => (y.apy_30d_avg ?? 0) >= apy30dMin);
    if (apy30dMax != null) result = result.filter((y) => (y.apy_30d_avg ?? 0) <= apy30dMax);
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
  }, [filters.apy30dMin, filters.apy30dMax, sortField, sortDir]);

  // Dropdown options derived from full unfiltered dataset
  const sources = useMemo(() => {
    const names = new Set(optionsData.map((y) => y.protocol_name).filter(Boolean));
    return Array.from(names).sort() as string[];
  }, [optionsData]);

  const allTokens = useMemo(() => {
    const tokens = new Set(optionsData.flatMap((y) => y.tokens).filter(Boolean));
    return Array.from(tokens).sort();
  }, [optionsData]);

  const allTokenTypes = useMemo(() => {
    const types = new Set(optionsData.flatMap((y) => y.underlying_tokens ?? []).map((t) => t.type));
    return Array.from(types).sort();
  }, [optionsData]);

  function syncToUrl(f: Filters, sf: SortField, sd: SortDir) {
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
    if (sf !== "apy") params.set("sort", sf);
    if (sd !== "desc") params.set("dir", sd);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "/discover", { scroll: false });
  }

  function updateFilters(f: Filters) {
    setFilters(f);
    setOffset(0);
    syncToUrl(f, sortField, sortDir);
  }

  function toggleSort(field: SortField) {
    setOffset(0);
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

  function applyFilters() {
    setFilters(draftFilters);
    setOffset(0);
    setFilterOpen(false);
    syncToUrl(draftFilters, sortField, sortDir);
  }

  function resetFilters() {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setOffset(0);
    setFilterOpen(false);
    syncToUrl(EMPTY_FILTERS, sortField, sortDir);
  }

  const activeFilterCount = [filters.protocol, filters.category, filters.token, filters.tokenType, filters.apyMin, filters.apyMax, filters.apy30dMin, filters.apy30dMax, filters.tvlMin, filters.tvlMax, filters.liquidityMin, filters.liquidityMax].filter(Boolean).length;

  return {
    filters,
    draftFilters,
    setDraftFilters,
    sortField,
    sortDir,
    filterOpen,
    setFilterOpen,
    processPage,
    backendSort,
    backendFilters,
    offset,
    setOffset,
    sources,
    allTokens,
    allTokenTypes,
    activeFilterCount,
    updateFilters,
    toggleSort,
    applyFilters,
    resetFilters,
  };
}
