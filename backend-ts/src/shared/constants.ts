export const KNOWN_TOKEN_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  So11111111111111111111111111111111111111112: "SOL",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "JITOSOL",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "MSOL",
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": "stSOL",
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: "bSOL",
};

export const STABLECOIN_SYMBOLS = new Set([
  // Pure USD stablecoins
  "USDC", "USDC-1", "USDC-Dep",
  "USDT",
  "USDS",
  "USDG",
  "PYUSD",
  "FDUSD",
  "EURC",
  "USDe", "sUSDe",
  "USDY",
  "USD1",
  "AUSD",
  "USDH",
  "USX",
  "eUSX",
  "JupUSD",
  // RWA / yield-bearing USD tokens
  "PRIME",
  "syrupUSDC",
  "USCC",
  "CASH",
  "FWDI",
  "wYLDS",
  "ONyc",
  "JUICED",
]);

export function computeDepeg(
  symbol: string,
  priceUsd: number | null,
): number | null {
  if (!STABLECOIN_SYMBOLS.has(symbol) || priceUsd === null) return null;
  return Math.round(Math.abs(priceUsd - 1.0) * 1e6) / 1e6;
}
