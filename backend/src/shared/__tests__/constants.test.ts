import { describe, it, expect } from "vitest";
import {
  classifyToken,
  isStablecoinMint,
  STABLECOIN_SYMBOLS,
  REGULAR_STABLES,
  YIELD_BEARING_STABLES,
  LST_SYMBOLS,
} from "../constants.js";

describe("classifyToken", () => {
  it("classifies regular stablecoins", () => {
    expect(classifyToken("USDC")).toBe("stable");
    expect(classifyToken("USDT")).toBe("stable");
    expect(classifyToken("PYUSD")).toBe("stable");
  });

  it("classifies yield-bearing stables", () => {
    expect(classifyToken("JUICED")).toBe("yield_bearing_stable");
  });

  it("classifies LSTs", () => {
    expect(classifyToken("mSOL")).toBe("lst");
    expect(classifyToken("jitoSOL")).toBe("lst");
    expect(classifyToken("JupSOL")).toBe("lst");
  });

  it("classifies volatile tokens", () => {
    expect(classifyToken("SOL")).toBe("volatile");
  });
});

describe("isStablecoinMint", () => {
  it("returns true for USDC mint", () => {
    expect(isStablecoinMint("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(true);
  });

  it("returns true for USDT mint", () => {
    expect(isStablecoinMint("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB")).toBe(true);
  });

  it("returns false for unknown mint", () => {
    expect(isStablecoinMint("unknown_mint_address")).toBe(false);
  });
});

describe("STABLECOIN_SYMBOLS", () => {
  it("contains common stablecoins", () => {
    expect(STABLECOIN_SYMBOLS.has("USDC")).toBe(true);
    expect(STABLECOIN_SYMBOLS.has("USDT")).toBe(true);
  });

  it("does not contain non-stablecoins", () => {
    expect(STABLECOIN_SYMBOLS.has("SOL")).toBe(false);
    expect(STABLECOIN_SYMBOLS.has("BONK")).toBe(false);
  });
});
