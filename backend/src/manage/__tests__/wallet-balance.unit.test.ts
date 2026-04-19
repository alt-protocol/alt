/**
 * Unit tests for wallet-balance.ts — on-chain balance fetching.
 * Mocks RPC connection and @solana/web3.js to test parsing logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock RPC
const mockGetBalance = vi.fn();
const mockGetParsedTokenAccountsByOwner = vi.fn();

vi.mock("../../shared/rpc.js", () => ({
  getLegacyConnection: vi.fn().mockResolvedValue({
    getBalance: (...args: any[]) => mockGetBalance(...args),
    getParsedTokenAccountsByOwner: (...args: any[]) =>
      mockGetParsedTokenAccountsByOwner(...args),
  }),
}));

// Mock @solana/web3.js — wallet-balance.ts does `await import("@solana/web3.js")`
vi.mock("@solana/web3.js", () => ({
  PublicKey: class MockPublicKey {
    _key: string;
    constructor(key: string) {
      this._key = key;
    }
    toString() {
      return this._key;
    }
  },
}));

const { fetchWalletBalance } = await import("../services/wallet-balance.js");

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("fetchWalletBalance", () => {
  beforeEach(() => {
    mockGetBalance.mockReset();
    mockGetParsedTokenAccountsByOwner.mockReset();
  });

  it("returns SOL balance in SOL (lamports / 1e9)", async () => {
    mockGetBalance.mockResolvedValue(2_500_000_000); // 2.5 SOL
    const balance = await fetchWalletBalance("WalletABC", SOL_MINT);
    expect(balance).toBe(2.5);
    expect(mockGetBalance).toHaveBeenCalledTimes(1);
  });

  it("returns 0 SOL for zero balance", async () => {
    mockGetBalance.mockResolvedValue(0);
    const balance = await fetchWalletBalance("WalletABC", SOL_MINT);
    expect(balance).toBe(0);
  });

  it("returns SPL token balance (sum of uiAmount)", async () => {
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({
      value: [
        {
          account: {
            data: { parsed: { info: { tokenAmount: { uiAmount: 75.5 } } } },
          },
        },
      ],
    });

    const balance = await fetchWalletBalance("WalletABC", USDC_MINT);
    expect(balance).toBe(75.5);
  });

  it("returns sum when wallet has multiple token accounts", async () => {
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({
      value: [
        {
          account: {
            data: { parsed: { info: { tokenAmount: { uiAmount: 30 } } } },
          },
        },
        {
          account: {
            data: { parsed: { info: { tokenAmount: { uiAmount: 20 } } } },
          },
        },
      ],
    });

    const balance = await fetchWalletBalance("WalletABC", USDC_MINT);
    expect(balance).toBe(50);
  });

  it("returns 0 when no token accounts exist", async () => {
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({ value: [] });
    const balance = await fetchWalletBalance("WalletABC", USDC_MINT);
    expect(balance).toBe(0);
  });

  it("handles missing uiAmount gracefully (defaults to 0)", async () => {
    mockGetParsedTokenAccountsByOwner.mockResolvedValue({
      value: [
        {
          account: {
            data: { parsed: { info: { tokenAmount: {} } } },
          },
        },
      ],
    });

    const balance = await fetchWalletBalance("WalletABC", USDC_MINT);
    expect(balance).toBe(0);
  });
});
