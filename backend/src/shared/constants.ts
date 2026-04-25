export const KNOWN_TOKEN_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  So11111111111111111111111111111111111111112: "SOL",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "JITOSOL",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "MSOL",
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": "stSOL",
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: "bSOL",
  // Stablecoins
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: "USDS",
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": "PYUSD",
  DEkqHyPN7GMRJ5cArtQFAWNfQT7dJQ262PuVhdxAGune: "USDe",
  Eh6XEPhSwoLv5wFApuLc5bTjQE2G4dEkVktFbEAuhuFQ: "sUSDe",
  A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6: "USDY",
  HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr: "EURC",
  USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX: "USDH",
  // Additional stablecoins (discovered from underlying_tokens)
  AUSD1jCcCyPLybk1YnvPWsHQSrZ46dxwoMniN4N2UEB9: "AUSD",
  CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH: "CASH",
  "9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u": "FDUSD",
  JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD: "JupUSD",
  USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB: "USD1",
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH": "USDG",
  "6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG": "USX",
  "5YMkXAYccHSGnHn9nob9xEvv6Pvka9DZWH7nTbotTu9E": "hyUSD",
  // Yield-bearing stablecoins
  "3ThdFZQKM6kRyVGLG48kaPg5TRMhYMKY1iCRa9xop1WC": "eUSX",
  "7GzQgf6DPo6ZANjnbhe9tNCpkGTv3zqHbsDx74jyQf9": "FWDI",
  "7GxATsNMnaC88vdwd2t3mwrFuQwwGvmYPrUQ4D6FotXk": "JUICED",
  "5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5": "ONyc",
  "3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7": "PRIME",
  "59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw": "PST",
  AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj: "syrupUSDC",
  BTRR3sj1Bn2ZjuemgbeQ6SCtf84iXS81CS7UDTSxUCaK: "USCC",
  // Exponent SOL staking / restaking tokens
  WFRGSWjaz8tbAxsJitmbfRuFV2mSNwy7BMWcCwaA28U: "fragSOL",
  BULKoNSGzxtCqzwTvg5hFJg8fx6dqZRScyXe5LYMfxrn: "BulkSOL",
  hy1oXYgrBW6PVcJ4s6s2FKavRdwgWTXdfE69AxT7kPT: "hyloSOL",
  hy1opf2bqRDwAxoktyWAj6f3UpeHcLydzEdKjMYGs2u: "hyloSOL+",
  // Exponent volatile tokens
  "4sWNB8zGWHkh6UnmwiEtzNxL4XrN7uK9tosbESbJFfVs": "xSOL",
  WFRGB49tP8CdKubqCdt5Spo2BdGS4BpgoinNER5TYUm: "fragBTC",
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
  "hyUSD",
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
]);

export const LST_SYMBOLS = new Set([
  "JITOSOL", "MSOL", "BSOL", "JUPSOL", "HSOL", "VSOL", "INF", "DSOL",
  "BONKSOL", "COMPASSSOL", "LAINESOL", "PATHSOL", "PICOSOL", "HUBSOL",
  "FRAGSOL", "BULKSOL", "HYLOSOL", "HYLOSOL+",
  "BNSOL", "CGNTSOL", "DFDVSOL", "JSOL", "NXSOL", "PSOL",
  "STKESOL", "STRONGSOL", "LANTERNSOL", "EZSOL",
]);

// Derived — union of regular + yield-bearing stables
export const STABLECOIN_SYMBOLS = new Set([
  ...REGULAR_STABLES,
  ...YIELD_BEARING_STABLES,
]);

// Tokens to skip when building multiply pairs (not real stablecoins, illiquid, etc.)
export const EXCLUDED_MULTIPLY_TOKENS = new Set(["wYLDS"]);

// ---------------------------------------------------------------------------
// Stablecoin peg tracking config — mints we actively monitor via Jupiter
// ---------------------------------------------------------------------------

export interface StablecoinPegEntry {
  mint: string;
  symbol: string;
  pegTarget: number | null; // null for yield-bearing (no fixed peg)
  pegType: "fixed" | "yield_bearing";
  decimals: number;
}

export const STABLECOIN_PEG_CONFIG: StablecoinPegEntry[] = [
  // Regular stables — fixed $1 peg
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC",   pegTarget: 1.0,  pegType: "fixed",          decimals: 6 },
  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",  symbol: "USDT",   pegTarget: 1.0,  pegType: "fixed",          decimals: 6 },
  { mint: "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",   symbol: "USDS",   pegTarget: 1.0,  pegType: "fixed",          decimals: 6 },
  { mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",  symbol: "PYUSD",  pegTarget: 1.0,  pegType: "fixed",          decimals: 6 },
  { mint: "DEkqHyPN7GMRJ5cArtQFAWNfQT7dJQ262PuVhdxAGune",   symbol: "USDe",   pegTarget: 1.0,  pegType: "fixed",          decimals: 6 },
  { mint: "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",    symbol: "USDH",   pegTarget: 1.0,  pegType: "fixed",          decimals: 6 },
  { mint: "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",  symbol: "EURC",   pegTarget: 1.08, pegType: "fixed",          decimals: 6 },
  { mint: "AUSD1jCcCyPLybk1YnvPWsHQSrZ46dxwoMniN4N2UEB9",   symbol: "AUSD",   pegTarget: 1.0,  pegType: "fixed",          decimals: 6 },
  { mint: "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH",   symbol: "CASH",   pegTarget: 1.0,  pegType: "fixed",          decimals: 6 },
  { mint: "9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u",  symbol: "FDUSD",  pegTarget: 1.0,  pegType: "fixed",          decimals: 6 },
  { mint: "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD",    symbol: "JupUSD", pegTarget: 1.0,  pegType: "fixed",          decimals: 6 },
  { mint: "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",     symbol: "USD1",   pegTarget: 1.0,  pegType: "fixed",          decimals: 6 },
  { mint: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",   symbol: "USDG",   pegTarget: 1.0,  pegType: "fixed",          decimals: 6 },
  { mint: "6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG",   symbol: "USX",    pegTarget: 1.0,  pegType: "fixed",          decimals: 6 },
  // Yield-bearing stables — no fixed peg, track volatility only
  { mint: "Eh6XEPhSwoLv5wFApuLc5bTjQE2G4dEkVktFbEAuhuFQ",   symbol: "sUSDe",     pegTarget: null, pegType: "yield_bearing", decimals: 9 },
  { mint: "A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6",   symbol: "USDY",      pegTarget: null, pegType: "yield_bearing", decimals: 6 },
  { mint: "3ThdFZQKM6kRyVGLG48kaPg5TRMhYMKY1iCRa9xop1WC",  symbol: "eUSX",      pegTarget: null, pegType: "yield_bearing", decimals: 6 },
  { mint: "7GzQgf6DPo6ZANjnbhe9tNCpkGTv3zqHbsDx74jyQf9",   symbol: "FWDI",      pegTarget: null, pegType: "yield_bearing", decimals: 6 },
  { mint: "7GxATsNMnaC88vdwd2t3mwrFuQwwGvmYPrUQ4D6FotXk",   symbol: "JUICED",    pegTarget: null, pegType: "yield_bearing", decimals: 6 },
  { mint: "5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5",  symbol: "ONyc",      pegTarget: null, pegType: "yield_bearing", decimals: 9 },
  { mint: "3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7",  symbol: "PRIME",     pegTarget: null, pegType: "yield_bearing", decimals: 6 },
  { mint: "59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw",   symbol: "PST",       pegTarget: null, pegType: "yield_bearing", decimals: 6 },
  { mint: "AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj",  symbol: "syrupUSDC", pegTarget: null, pegType: "yield_bearing", decimals: 6 },
  { mint: "BTRR3sj1Bn2ZjuemgbeQ6SCtf84iXS81CS7UDTSxUCaK",  symbol: "USCC",      pegTarget: null, pegType: "yield_bearing", decimals: 6 },
];

/** Lookup peg config by symbol */
export function getPegConfig(symbol: string): StablecoinPegEntry | undefined {
  return STABLECOIN_PEG_CONFIG.find((e) => e.symbol === symbol);
}

export function classifyToken(symbol: string): string {
  // Strip common token wrapper prefixes (e.g., "PT eUSX" → "eUSX")
  const bare = symbol.replace(/^(PT|YT)\s+/, "");
  if (YIELD_BEARING_STABLES.has(bare)) return "yield_bearing_stable";
  const upper = bare.toUpperCase();
  for (const s of REGULAR_STABLES) {
    if (s.toUpperCase() === upper) return "stable";
  }
  if (LST_SYMBOLS.has(upper)) return "lst";
  return "volatile";
}

export function getSymbolForMint(mint: string): string | null {
  return KNOWN_TOKEN_MINTS[mint] ?? null;
}

const MINT_BY_SYMBOL: Record<string, string> = Object.fromEntries(
  Object.entries(KNOWN_TOKEN_MINTS).map(([mint, sym]) => [sym.toUpperCase(), mint]),
);

/** Reverse lookup: symbol → mint address. Returns null if unknown. */
export function getMintForSymbol(symbol: string): string | null {
  return MINT_BY_SYMBOL[symbol.toUpperCase()] ?? null;
}

export function isStablecoinMint(mint: string): boolean {
  const symbol = getSymbolForMint(mint);
  return symbol !== null && STABLECOIN_SYMBOLS.has(symbol);
}

export const APP_URL = process.env.APP_URL ?? "http://localhost:8001";
export const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

if (!process.env.APP_URL && process.env.NODE_ENV === "production") {
  console.warn("[WARN] APP_URL not set in production — action URLs will point to localhost");
}

export function computeDepeg(
  symbol: string,
  priceUsd: number | null,
): number | null {
  if (!STABLECOIN_SYMBOLS.has(symbol) || priceUsd === null) return null;
  const cfg = getPegConfig(symbol);
  const target = cfg?.pegTarget ?? 1.0;
  return Math.round(Math.abs(priceUsd - target) * 1e6) / 1e6;
}
