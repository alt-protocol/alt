"use client";

import { useState, useCallback } from "react";

const STORAGE_KEY = "akashi-discover-columns-v2";

const ALL_COLUMNS = [
  "name",
  "protocol",
  "strategy",
  "tokens",
  "tvl",
  "depositCap",
  "apr",
  "apr30d",
  "volatility",
  "dexLiquidity",
  "risk",
] as const;

export type ColumnKey = (typeof ALL_COLUMNS)[number];

const DEFAULT_VISIBLE: ColumnKey[] = [
  "name",
  "protocol",
  "strategy",
  "tokens",
  "depositCap",
  "apr",
  "apr30d",
  "risk",
];

const REQUIRED: ColumnKey[] = ["name"];

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  name: "Name",
  protocol: "Protocol",
  strategy: "Strategy",
  tokens: "Tokens",
  tvl: "TVL",
  depositCap: "Available to Deposit",
  apr: "APR",
  apr30d: "30D APR",
  volatility: "Peg Spread",
  dexLiquidity: "DEX Liquidity",
  risk: "Token Info",
};

function loadFromStorage(): ColumnKey[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as string[];
    return parsed.filter((k): k is ColumnKey => ALL_COLUMNS.includes(k as ColumnKey));
  } catch {
    return null;
  }
}

function saveToStorage(cols: ColumnKey[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cols));
}

export function useColumnToggle() {
  const [visible, setVisible] = useState<ColumnKey[]>(() => loadFromStorage() ?? DEFAULT_VISIBLE);

  const toggle = useCallback((key: ColumnKey) => {
    if (REQUIRED.includes(key)) return;
    setVisible((prev) => {
      const next = prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key];
      saveToStorage(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setVisible(DEFAULT_VISIBLE);
    saveToStorage(DEFAULT_VISIBLE);
  }, []);

  return {
    visibleColumns: visible,
    allColumns: ALL_COLUMNS,
    requiredColumns: REQUIRED,
    toggleColumn: toggle,
    resetColumns: reset,
  };
}
