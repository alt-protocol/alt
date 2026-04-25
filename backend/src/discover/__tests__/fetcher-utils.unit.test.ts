/**
 * Unit tests for discover/services/utils.ts — fetcher utility functions.
 * Tests pure logic without DB dependencies.
 */
import { describe, it, expect } from "vitest";
import { buildUnderlyingTokens, classifyMultiplyPair, deriveAssetClass } from "../services/utils.js";

describe("buildUnderlyingTokens", () => {
  it("builds multiply pair with collateral and debt roles", () => {
    const tokens = buildUnderlyingTokens("multiply", ["SOL", "USDC"], {
      collateral_mint: "So11111111111111111111111111111111111111112",
      debt_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });

    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({
      symbol: "SOL",
      role: "collateral",
      mint: "So11111111111111111111111111111111111111112",
    });
    expect(tokens[1]).toMatchObject({
      symbol: "USDC",
      role: "debt",
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
  });

  it("uses supply_token_mint/borrow_token_mint as fallback (Jupiter style)", () => {
    const tokens = buildUnderlyingTokens("multiply", ["JUICED", "USDC"], {
      supply_token_mint: "JuicedMint111",
      borrow_token_mint: "USDCMint111",
    });

    expect(tokens[0].mint).toBe("JuicedMint111");
    expect(tokens[1].mint).toBe("USDCMint111");
  });

  it("builds single token for earn/lending categories", () => {
    const tokens = buildUnderlyingTokens("earn", ["USDC"], {
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      symbol: "USDC",
      role: "underlying",
    });
  });

  it("uses token_mint as fallback for single tokens", () => {
    const tokens = buildUnderlyingTokens("earn", ["USDC"], {
      token_mint: "TokenMint111",
    });

    expect(tokens[0].mint).toBe("TokenMint111");
  });

  it("returns UNKNOWN when no tokens provided", () => {
    const tokens = buildUnderlyingTokens("earn", [], {});
    expect(tokens[0].symbol).toBe("UNKNOWN");
  });

  it("handles multiply with single token (edge case)", () => {
    const tokens = buildUnderlyingTokens("multiply", ["SOL"], {});
    // Not enough tokens for multiply pair, falls back to single token
    expect(tokens).toHaveLength(1);
  });
});

describe("classifyMultiplyPair", () => {
  it("classifies SOL/USDC as directional_leverage (SOL is volatile)", () => {
    // SOL is classified as "volatile", not "lst"
    expect(classifyMultiplyPair("SOL", "USDC")).toBe("directional_leverage");
  });

  it("classifies mSOL/SOL as sol_loop (LST collateral)", () => {
    expect(classifyMultiplyPair("mSOL", "SOL")).toBe("sol_loop");
  });

  it("classifies JitoSOL/SOL as sol_loop", () => {
    expect(classifyMultiplyPair("JitoSOL", "SOL")).toBe("sol_loop");
  });

  it("classifies USDC/USDT as stable_loop", () => {
    expect(classifyMultiplyPair("USDC", "USDT")).toBe("stable_loop");
  });

  it("classifies BONK/USDC as directional_leverage", () => {
    expect(classifyMultiplyPair("BONK", "USDC")).toBe("directional_leverage");
  });
});

describe("deriveAssetClass", () => {
  it("returns stablecoin for USDC earn", () => {
    expect(deriveAssetClass("earn", ["USDC"], {})).toBe("stablecoin");
  });

  it("returns stablecoin for yield-bearing stables", () => {
    expect(deriveAssetClass("earn", ["eUSX"], {})).toBe("stablecoin");
    expect(deriveAssetClass("earn", ["ONyc"], {})).toBe("stablecoin");
    expect(deriveAssetClass("earn", ["PRIME"], {})).toBe("stablecoin");
  });

  it("returns sol for LST tokens", () => {
    expect(deriveAssetClass("earn", ["JITOSOL"], {})).toBe("sol");
    expect(deriveAssetClass("earn", ["MSOL"], {})).toBe("sol");
  });

  it("returns sol for SOL token", () => {
    expect(deriveAssetClass("earn", ["SOL"], {})).toBe("sol");
  });

  it("returns btc for BTC tokens", () => {
    expect(deriveAssetClass("earn", ["fragBTC"], {})).toBe("btc");
    expect(deriveAssetClass("earn", ["cbBTC"], {})).toBe("btc");
  });

  it("returns stablecoin for multiply stable_loop", () => {
    expect(deriveAssetClass("multiply", ["USDC", "USDT"], { vault_tag: "stable_loop" })).toBe("stablecoin");
  });

  it("returns stablecoin for multiply rwa_loop", () => {
    expect(deriveAssetClass("multiply", ["USDY", "USDC"], { vault_tag: "rwa_loop" })).toBe("stablecoin");
  });

  it("returns sol for multiply sol_loop", () => {
    expect(deriveAssetClass("multiply", ["JITOSOL", "SOL"], { vault_tag: "sol_loop" })).toBe("sol");
  });

  it("returns eth for ETH token", () => {
    expect(deriveAssetClass("lending", ["ETH"], {})).toBe("eth");
    expect(deriveAssetClass("lending", ["WETH"], {})).toBe("eth");
  });

  it("returns sol for unlisted SOL LSTs via wildcard", () => {
    expect(deriveAssetClass("lending", ["nxSOL"], {})).toBe("sol");
    expect(deriveAssetClass("lending", ["strongSOL"], {})).toBe("sol");
    expect(deriveAssetClass("lending", ["cgntSOL"], {})).toBe("sol");
  });

  it("returns other for non-SOL tokens ending in SOL-like suffix", () => {
    expect(deriveAssetClass("earn", ["JLP"], {})).toBe("other");
  });

  it("keeps multiply directional_leverage as other", () => {
    expect(deriveAssetClass("multiply", ["USDC", "SOL"], { vault_tag: "directional_leverage" })).toBe("other");
    expect(deriveAssetClass("multiply", ["SOL", "USDC"], { vault_tag: "directional_leverage" })).toBe("other");
  });

  it("returns other for unknown tokens", () => {
    expect(deriveAssetClass("earn", ["BONK"], {})).toBe("other");
  });

  it("returns other for empty tokens", () => {
    expect(deriveAssetClass("earn", [], {})).toBe("other");
  });
});
