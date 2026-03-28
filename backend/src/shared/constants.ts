export const KNOWN_TOKEN_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  So11111111111111111111111111111111111111112: "SOL",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "JITOSOL",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "MSOL",
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": "stSOL",
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: "bSOL",
};

// ---------------------------------------------------------------------------
// Token classification — single source of truth
// ---------------------------------------------------------------------------

export const REGULAR_STABLES = new Set([
  "USDC", "USDC-1", "USDC-Dep", "USDC 5m 3%", "USDC 15m 5%",
  "USDT",
  "USDS",
  "USDG",
  "PYUSD",
  "FDUSD",
  "EURC",
  "USDe",
  "USD1",
  "AUSD",
  "USDH",
  "USX",
  "JupUSD",
  "CASH",
]);

export const YIELD_BEARING_STABLES = new Set([
  "PRIME",
  "syrupUSDC",
  "ONyc",
  "USCC",
  "PST",
  "eUSX",
  "JUICED",
  "sUSDe",
  "USDY",
  "FWDI",
  "wYLDS",
]);

export const LST_SYMBOLS = new Set([
  "JITOSOL", "MSOL", "BSOL", "JUPSOL", "HSOL", "VSOL", "INF", "DSOL",
  "BONKSOL", "COMPASSSOL", "LAINESOL", "PATHSOL", "PICOSOL", "HUBSOL",
]);

// Derived — union of regular + yield-bearing stables
export const STABLECOIN_SYMBOLS = new Set([
  ...REGULAR_STABLES,
  ...YIELD_BEARING_STABLES,
]);

export function computeDepeg(
  symbol: string,
  priceUsd: number | null,
): number | null {
  if (!STABLECOIN_SYMBOLS.has(symbol) || priceUsd === null) return null;
  return Math.round(Math.abs(priceUsd - 1.0) * 1e6) / 1e6;
}
