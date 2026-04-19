/**
 * Unit tests for jupiter-swap.ts — swap quote and instruction building.
 * Mocks HTTP client to test parsing and conversion logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock HTTP
const mockGetWithRetry = vi.fn();
vi.mock("../../shared/http.js", () => ({
  getWithRetry: (...args: any[]) => mockGetWithRetry(...args),
  jupiterHeaders: vi.fn().mockReturnValue({ "x-api-key": "test" }),
}));

const { getSwapQuote, buildSwapInstructions } = await import(
  "../services/jupiter-swap.js"
);

const PARAMS = {
  inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  outputMint: "So11111111111111111111111111111111111111112",
  amount: "1000000",
  taker: "11111111111111111111111111111112",
  slippageBps: 50,
};

describe("getSwapQuote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed quote from Jupiter API response", async () => {
    mockGetWithRetry.mockResolvedValue({
      outAmount: "50000000",
      feeBps: 4,
      priceImpactPct: 0.01,
      router: "Metis",
    });

    const quote = await getSwapQuote(PARAMS);

    expect(quote.inputMint).toBe(PARAMS.inputMint);
    expect(quote.outputMint).toBe(PARAMS.outputMint);
    expect(quote.inAmount).toBe("1000000");
    expect(quote.outAmount).toBe("50000000");
    expect(quote.feeBps).toBe(4);
    expect(quote.priceImpactPct).toBe(0.01);
    expect(quote.router).toBe("Metis");
  });

  it("handles missing fields with defaults", async () => {
    mockGetWithRetry.mockResolvedValue({});

    const quote = await getSwapQuote(PARAMS);

    expect(quote.outAmount).toBe("0");
    expect(quote.feeBps).toBe(0);
    expect(quote.priceImpactPct).toBe(0);
    expect(quote.router).toBe("unknown");
  });

  it("constructs correct API URL with query params", async () => {
    mockGetWithRetry.mockResolvedValue({});

    await getSwapQuote(PARAMS);

    const calledUrl = mockGetWithRetry.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/swap/v2/order?");
    expect(calledUrl).toContain(`inputMint=${PARAMS.inputMint}`);
    expect(calledUrl).toContain(`outputMint=${PARAMS.outputMint}`);
    expect(calledUrl).toContain(`amount=${PARAMS.amount}`);
    expect(calledUrl).toContain(`taker=${PARAMS.taker}`);
    expect(calledUrl).toContain("slippageBps=50");
  });

  it("defaults slippageBps to 50 when not provided", async () => {
    mockGetWithRetry.mockResolvedValue({});

    await getSwapQuote({
      inputMint: "A",
      outputMint: "B",
      amount: "100",
      taker: "C",
    });

    const calledUrl = mockGetWithRetry.mock.calls[0][0] as string;
    expect(calledUrl).toContain("slippageBps=50");
  });

  it("propagates API errors", async () => {
    mockGetWithRetry.mockRejectedValue(new Error("HTTP 429: Rate limited"));

    await expect(getSwapQuote(PARAMS)).rejects.toThrow("HTTP 429");
  });
});

describe("buildSwapInstructions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts Jupiter API response to instructions + ALTs", async () => {
    mockGetWithRetry.mockResolvedValue({
      computeBudgetInstructions: [
        {
          programId: "ComputeBudget111111111111111111111111111111",
          accounts: [],
          data: "AQAAAA==",
        },
      ],
      setupInstructions: [],
      swapInstruction: {
        programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
        accounts: [
          { pubkey: "AccA", isSigner: true, isWritable: true },
        ],
        data: "AQID", // base64 of [1,2,3]
      },
      cleanupInstruction: null,
      otherInstructions: [],
      addressesByLookupTableAddress: {
        "LUT111111111111111111111111111111111111111": ["addr1", "addr2"],
      },
    });

    const result = await buildSwapInstructions(PARAMS);

    expect(result.instructions).toHaveLength(2); // computeBudget + swap
    expect(result.lookupTableAddresses).toEqual([
      "LUT111111111111111111111111111111111111111",
    ]);
  });

  it("handles empty instruction groups", async () => {
    mockGetWithRetry.mockResolvedValue({
      computeBudgetInstructions: [],
      setupInstructions: [],
      swapInstruction: {
        programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
        accounts: [],
        data: "",
      },
      cleanupInstruction: null,
      otherInstructions: [],
      addressesByLookupTableAddress: {},
    });

    const result = await buildSwapInstructions(PARAMS);
    expect(result.instructions).toHaveLength(1); // only swap
    expect(result.lookupTableAddresses).toEqual([]);
  });

  it("includes all instruction groups when present", async () => {
    const makeIx = (programId: string) => ({
      programId,
      accounts: [],
      data: "",
    });

    mockGetWithRetry.mockResolvedValue({
      computeBudgetInstructions: [makeIx("CB")],
      setupInstructions: [makeIx("Setup1"), makeIx("Setup2")],
      swapInstruction: makeIx("Swap"),
      cleanupInstruction: makeIx("Cleanup"),
      otherInstructions: [makeIx("Other")],
      addressesByLookupTableAddress: {},
    });

    const result = await buildSwapInstructions(PARAMS);
    // 1 CB + 2 setup + 1 swap + 1 cleanup + 1 other = 6
    expect(result.instructions).toHaveLength(6);
  });

  it("propagates API errors", async () => {
    mockGetWithRetry.mockRejectedValue(new Error("HTTP 500: Server error"));
    await expect(buildSwapInstructions(PARAMS)).rejects.toThrow("HTTP 500");
  });
});
