"use client";

import { useState } from "react";

const STORAGE_KEY = "akashi:slippageBps";
const DEFAULT_BPS = 30;

/**
 * Persisted slippage preference (in basis points).
 * Stored in localStorage so it survives page reloads.
 */
export function useSlippage(defaultBps = DEFAULT_BPS) {
  const [bps, setBps] = useState(() => {
    if (typeof window === "undefined") return defaultBps;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? Number(stored) : defaultBps;
  });

  function setSlippage(value: number) {
    const clamped = Math.max(1, Math.min(500, Math.round(value)));
    setBps(clamped);
    localStorage.setItem(STORAGE_KEY, String(clamped));
  }

  return { slippageBps: bps, setSlippage };
}
