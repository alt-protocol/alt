/**
 * Unit tests for the Exponent manage adapter.
 * Mocks the SDK to test dispatch logic and instruction conversion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK — must be before imports
const mockIxWrapperBuyPt = vi.fn();
const mockIxWrapperSellPt = vi.fn();
const mockIxWrapperProvideLiquidity = vi.fn();
const mockIxWithdrawLiquidityToBase = vi.fn();

const mockMarketInstance = {
  addressLookupTable: { toBase58: () => "ALT_ADDRESS" },
  state: { ticks: { currentSpotPrice: 0.05 } },
  ixWrapperBuyPt: mockIxWrapperBuyPt,
  ixWrapperSellPt: mockIxWrapperSellPt,
  ixWrapperProvideLiquidity: mockIxWrapperProvideLiquidity,
  ixWithdrawLiquidityToBase: mockIxWithdrawLiquidityToBase,
};

vi.mock("@exponent-labs/exponent-sdk", () => ({
  MarketThree: {
    load: vi.fn().mockResolvedValue(mockMarketInstance),
  },
  LOCAL_ENV: {},
}));

vi.mock("@solana/web3.js", () => ({
  PublicKey: class MockPublicKey {
    _key: string;
    constructor(key: string) { this._key = key; }
    toBase58() { return this._key; }
  },
}));

vi.mock("../../shared/rpc.js", () => ({
  getLegacyConnection: vi.fn().mockResolvedValue({}),
}));

import { exponentAdapter } from "../protocols/exponent.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeLegacyIx() {
  return {
    programId: { toBase58: () => "PROGRAM_ID" },
    keys: [{ pubkey: { toBase58: () => "ACC1" }, isSigner: false, isWritable: true }],
    data: Buffer.from([1, 2, 3]),
  };
}

describe("exponentAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIxWrapperBuyPt.mockResolvedValue({ ixs: [makeLegacyIx()], setupIxs: [] });
    mockIxWrapperSellPt.mockResolvedValue({ ixs: [makeLegacyIx()], setupIxs: [] });
    mockIxWrapperProvideLiquidity.mockResolvedValue({ ixs: [makeLegacyIx()], setupIxs: [], signers: [] });
    mockIxWithdrawLiquidityToBase.mockResolvedValue({ ixs: [makeLegacyIx()], setupIxs: [] });
  });

  describe("buildDepositTx", () => {
    it("dispatches to PT buy for exponent_pt type", async () => {
      const result = await exponentAdapter.buildDepositTx({
        walletAddress: "WALLET123",
        depositAddress: "VAULT_ADDR",
        amount: "100",
        category: "earn",
        extraData: { type: "exponent_pt", market_vault: "VAULT_ADDR", decimals: 6 },
      });

      expect(mockIxWrapperBuyPt).toHaveBeenCalledTimes(1);
      expect(mockIxWrapperProvideLiquidity).not.toHaveBeenCalled();
      expect(Array.isArray(result) ? result : (result as any).instructions).toBeDefined();
    });

    it("dispatches to LP deposit for exponent_lp type", async () => {
      const result = await exponentAdapter.buildDepositTx({
        walletAddress: "WALLET123",
        depositAddress: "VAULT_ADDR",
        amount: "100",
        category: "earn",
        extraData: { type: "exponent_lp", market_vault: "VAULT_ADDR", decimals: 6 },
      });

      expect(mockIxWrapperProvideLiquidity).toHaveBeenCalledTimes(1);
      expect(mockIxWrapperBuyPt).not.toHaveBeenCalled();
    });

    it("defaults to PT when type is not set", async () => {
      await exponentAdapter.buildDepositTx({
        walletAddress: "WALLET123",
        depositAddress: "VAULT_ADDR",
        amount: "100",
        category: "earn",
        extraData: { market_vault: "VAULT_ADDR" },
      });

      expect(mockIxWrapperBuyPt).toHaveBeenCalledTimes(1);
    });
  });

  describe("buildWithdrawTx", () => {
    it("dispatches to PT sell for exponent_pt type", async () => {
      await exponentAdapter.buildWithdrawTx({
        walletAddress: "WALLET123",
        depositAddress: "VAULT_ADDR",
        amount: "50",
        category: "earn",
        extraData: { type: "exponent_pt", market_vault: "VAULT_ADDR", decimals: 6 },
      });

      expect(mockIxWrapperSellPt).toHaveBeenCalledTimes(1);
    });

    it("dispatches to LP withdraw for exponent_lp type", async () => {
      await exponentAdapter.buildWithdrawTx({
        walletAddress: "WALLET123",
        depositAddress: "VAULT_ADDR",
        amount: "50",
        category: "earn",
        extraData: { type: "exponent_lp", market_vault: "VAULT_ADDR", lp_position: "LP_POS_ADDR", decimals: 6 },
      });

      expect(mockIxWithdrawLiquidityToBase).toHaveBeenCalledTimes(1);
    });

    it("throws for LP withdraw without position address", async () => {
      await expect(
        exponentAdapter.buildWithdrawTx({
          walletAddress: "WALLET123",
          depositAddress: "VAULT_ADDR",
          amount: "50",
          category: "earn",
          extraData: { type: "exponent_lp", market_vault: "VAULT_ADDR" },
        }),
      ).rejects.toThrow("LP position address required");
    });
  });

  it("returns lookup table addresses", async () => {
    const result = await exponentAdapter.buildDepositTx({
      walletAddress: "WALLET123",
      depositAddress: "VAULT_ADDR",
      amount: "100",
      category: "earn",
      extraData: { type: "exponent_pt", market_vault: "VAULT_ADDR" },
    });

    expect((result as any).lookupTableAddresses).toContain("ALT_ADDRESS");
  });
});
