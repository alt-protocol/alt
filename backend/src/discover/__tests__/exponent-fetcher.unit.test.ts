/**
 * Unit tests for the Exponent discover fetcher.
 * Mocks HTTP calls and DB operations to test filtering and upsert logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock HTTP
const mockGetOrNull = vi.fn();
vi.mock("../../shared/http.js", () => ({
  getOrNull: (...args: any[]) => mockGetOrNull(...args),
}));

// Mock DB + utils
const mockUpsert = vi.fn().mockResolvedValue({ id: 1 });
const mockDeactivate = vi.fn().mockResolvedValue(0);
const mockGetProtocol = vi.fn();
vi.mock("../services/utils.js", () => ({
  upsertOpportunity: (...args: any[]) => mockUpsert(...args),
  deactivateStale: (...args: any[]) => mockDeactivate(...args),
  getProtocol: (...args: any[]) => mockGetProtocol(...args),
  batchSnapshotAvg: vi.fn().mockResolvedValue({}),
  safeFloat: (v: unknown) => (v != null ? Number(v) : null),
  tokenType: (symbol: string) => {
    const upper = symbol.toUpperCase();
    if (["USDC", "USDT", "USDS", "PYUSD"].includes(upper)) return "stablecoin";
    if (upper.endsWith("SOL")) return "lst";
    return "volatile";
  },
}));

vi.mock("../db/connection.js", () => ({ db: {} }));

import { fetchExponentYields } from "../services/exponent-fetcher.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeMarket(overrides: Record<string, unknown> = {}) {
  return {
    vaultAddress: "4hZugBhgd3xxShK5iHbBAwCnJUjthiStT6LnruRwarjr",
    underlyingAsset: { mint: "6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG", ticker: "USX", name: "USX", decimals: 6 },
    ptMint: "ptMint123",
    ytMint: "ytMint123",
    syMint: "syMint123",
    impliedApy: 0.055,
    totalMarketSize: 19000000,
    maturityDateUnixTs: Math.floor(Date.now() / 1000) + 86400 * 30,
    marketStatus: "active",
    categories: ["Stablecoins"],
    platformName: "Solstice",
    tokenName: "USX",
    syExchangeRate: 1,
    annualizedLpFeesPct: 0,
    liquidity: 1000000,
    legacyLiquidity: 0,
    underlyingApy: 0,
    ...overrides,
  };
}

describe("fetchExponentYields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProtocol.mockResolvedValue({ id: 5, name: "Exponent" });
  });

  it("returns 0 if protocol not seeded", async () => {
    mockGetProtocol.mockResolvedValue(null);
    const count = await fetchExponentYields();
    expect(count).toBe(0);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 0 if API returns null", async () => {
    mockGetOrNull.mockResolvedValue(null);
    const count = await fetchExponentYields();
    expect(count).toBe(0);
  });

  it("creates PT + LP for stablecoin market", async () => {
    mockGetOrNull.mockResolvedValue([makeMarket()]);
    const count = await fetchExponentYields();
    expect(count).toBe(2); // 1 PT + 1 LP
    expect(mockUpsert).toHaveBeenCalledTimes(2);

    const ptCall = mockUpsert.mock.calls[0][1];
    expect(ptCall.externalId).toMatch(/^exponent-pt-/);
    expect(ptCall.category).toBe("earn");
    expect(ptCall.apyCurrent).toBeCloseTo(5.5, 0);
    expect(ptCall.riskTier).toBe("low");

    const lpCall = mockUpsert.mock.calls[1][1];
    expect(lpCall.externalId).toMatch(/^exponent-lp-/);
    expect(lpCall.riskTier).toBe("medium");
  });

  it("includes non-stablecoin markets with correct asset_class", async () => {
    mockGetOrNull.mockResolvedValue([
      makeMarket({
        categories: ["SOL", "Staking"],
        underlyingAsset: { mint: "WFRGSWjaz8tbAxsJitmbfRuFV2mSNwy7BMWcCwaA28U", ticker: "fragSOL", name: "fragSOL", decimals: 9 },
        tokenName: "fragSOL",
      }),
    ]);
    const count = await fetchExponentYields();
    expect(count).toBe(2); // PT + LP
    const ptCall = mockUpsert.mock.calls[0][1];
    expect(ptCall.assetClass).toBe("sol");
  });

  it("sets asset_class=stablecoin for stablecoin markets", async () => {
    mockGetOrNull.mockResolvedValue([makeMarket()]);
    await fetchExponentYields();
    const ptCall = mockUpsert.mock.calls[0][1];
    expect(ptCall.assetClass).toBe("stablecoin");
  });

  it("skips expired markets", async () => {
    mockGetOrNull.mockResolvedValue([
      makeMarket({ maturityDateUnixTs: Math.floor(Date.now() / 1000) - 3600 }),
    ]);
    const count = await fetchExponentYields();
    expect(count).toBe(0);
  });

  it("skips inactive markets", async () => {
    mockGetOrNull.mockResolvedValue([
      makeMarket({ marketStatus: "expired" }),
    ]);
    const count = await fetchExponentYields();
    expect(count).toBe(0);
  });

  it("skips LP if no liquidity", async () => {
    mockGetOrNull.mockResolvedValue([
      makeMarket({ liquidity: 0, legacyLiquidity: 0 }),
    ]);
    const count = await fetchExponentYields();
    expect(count).toBe(1); // PT only
  });

  it("calls deactivateStale for both PT and LP patterns", async () => {
    mockGetOrNull.mockResolvedValue([makeMarket()]);
    await fetchExponentYields();
    expect(mockDeactivate).toHaveBeenCalledTimes(2);
    expect(mockDeactivate.mock.calls[0][1]).toBe("exponent-pt-%");
    expect(mockDeactivate.mock.calls[1][1]).toBe("exponent-lp-%");
  });
});
