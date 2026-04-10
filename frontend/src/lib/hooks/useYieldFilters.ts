"use client";

import { useState, useMemo } from "react";
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

export function useYieldFilters(allYields: YieldOpportunity[]) {
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

  // 30d sort is client-side only; for apy/tvl we use backend sort
  const backendSort = sortField === "apy30d" || sortField === "liquidity" ? "apy_desc" : `${sortField}_${sortDir}`;

  const filteredYields = useMemo(() => {
    let result = allYields;
    if (filters.protocol) result = result.filter((y) => y.protocol_name === filters.protocol);
    if (filters.token) result = result.filter((y) => y.tokens.includes(filters.token));
    if (filters.tokenType) result = result.filter((y) => y.underlying_tokens?.some((t) => t.type === filters.tokenType));
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

  const allTokenTypes = useMemo(() => {
    const types = new Set(allYields.flatMap((y) => y.underlying_tokens ?? []).map((t) => t.type));
    return Array.from(types).sort();
  }, [allYields]);

  function syncToUrl(f: Filters, sf: SortField, sd: SortDir) {
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
    if (sf !== "apy") params.set("sort", sf);
    if (sd !== "desc") params.set("dir", sd);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "/dashboard", { scroll: false });
  }

  function updateFilters(f: Filters) {
    setFilters(f);
    syncToUrl(f, sortField, sortDir);
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

  const activeFilterCount = [filters.protocol, filters.category, filters.token, filters.tokenType, filters.apyMin, filters.apyMax, filters.apy30dMin, filters.apy30dMax, filters.tvlMin, filters.tvlMax, filters.liquidityMin, filters.liquidityMax].filter(Boolean).length;

  return {
    filters,
    draftFilters,
    setDraftFilters,
    sortField,
    sortDir,
    filterOpen,
    setFilterOpen,
    filteredYields,
    backendSort,
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
