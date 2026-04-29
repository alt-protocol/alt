"use client";

import { useState, useCallback } from "react";

const STORAGE_KEY = "akashi-position-columns-v3";

const ALL_COLUMNS = [
  "protocol",
  "type",
  "token",
  "netValue",
  "pnl",
  "apyCurrent",
  "apyRealized",
  "projYield",
  "held",
] as const;

export type PositionColumnKey = (typeof ALL_COLUMNS)[number];

const DEFAULT_VISIBLE: PositionColumnKey[] = [
  "protocol",
  "type",
  "token",
  "netValue",
  "apyCurrent",
  "pnl",
  "held",
];

const REQUIRED: PositionColumnKey[] = ["token", "netValue"];

export const POSITION_COLUMN_LABELS: Record<PositionColumnKey, string> = {
  protocol: "Protocol",
  type: "Strategy",
  token: "Token",
  netValue: "Net Value",
  pnl: "PnL",
  apyCurrent: "APY Current",
  apyRealized: "APY Realized",
  projYield: "Proj. Yield/yr",
  held: "Days Held",
};

function loadFromStorage(): PositionColumnKey[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as string[];
    return parsed.filter((k): k is PositionColumnKey => ALL_COLUMNS.includes(k as PositionColumnKey));
  } catch {
    return null;
  }
}

function saveToStorage(cols: PositionColumnKey[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cols));
}

export function usePositionColumnToggle() {
  const [visible, setVisible] = useState<PositionColumnKey[]>(() => loadFromStorage() ?? DEFAULT_VISIBLE);

  const toggle = useCallback((key: PositionColumnKey) => {
    if (REQUIRED.includes(key)) return;
    setVisible((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
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
