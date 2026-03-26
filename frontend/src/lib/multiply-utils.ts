/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TxStatus } from "./hooks/useTransaction";

export interface LeverageEntry {
  key: string;
  value: number;
  netApy: number | null;
}

/**
 * Parse the leverage_table from extra_data into sorted entries.
 * Each entry has the leverage key (e.g. "3x"), numeric value, and net APY.
 */
export function parseLeverageTable(extra: Record<string, unknown> | null): LeverageEntry[] {
  const table = extra?.leverage_table as Record<string, any> | undefined;
  if (!table) return [];
  return Object.entries(table)
    .map(([key, data]) => ({
      key,
      value: parseFloat(key),
      netApy: typeof data === "object" && data?.net_apy_current_pct != null
        ? Number(data.net_apy_current_pct)
        : typeof data === "number" ? data : null,
    }))
    .sort((a, b) => a.value - b.value);
}

/**
 * Interpolate net APY for any leverage value from discrete leverage_table entries.
 * Uses linear interpolation between the two nearest data points.
 */
export function interpolateApy(entries: LeverageEntry[], leverage: number): number | null {
  if (entries.length === 0) return null;
  const withApy = entries.filter((e) => e.netApy != null);
  if (withApy.length === 0) return null;

  // Exact match
  const exact = withApy.find((e) => e.value === leverage);
  if (exact) return exact.netApy;

  // Clamp to range
  if (leverage <= withApy[0].value) return withApy[0].netApy;
  if (leverage >= withApy[withApy.length - 1].value) return withApy[withApy.length - 1].netApy;

  // Find surrounding entries and interpolate
  for (let i = 0; i < withApy.length - 1; i++) {
    if (leverage >= withApy[i].value && leverage <= withApy[i + 1].value) {
      const t = (leverage - withApy[i].value) / (withApy[i + 1].value - withApy[i].value);
      return withApy[i].netApy! + t * (withApy[i + 1].netApy! - withApy[i].netApy!);
    }
  }
  return null;
}

/**
 * Map TxStatus to a user-facing status label (multiply-specific wording).
 */
export function getMultiplyStatusLabel(status: TxStatus): string | null {
  switch (status) {
    case "preparing": return "Setting up lookup tables...";
    case "building": return "Building transaction...";
    case "signing": return "Approve in wallet...";
    case "confirming": return "Confirming...";
    default: return null;
  }
}
