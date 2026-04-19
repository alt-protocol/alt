/**
 * Unit tests for tx-preview.ts — transaction simulation and fee estimation.
 * Mocks tx-assembler and RPC to test simulation logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SerializableInstruction } from "../../shared/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock tx-assembler
const mockBuildRawTransaction = vi.fn();
vi.mock("../services/tx-assembler.js", () => ({
  buildRawTransaction: (...args: any[]) => mockBuildRawTransaction(...args),
}));

// Mock RPC
const mockSimulateTransaction = vi.fn();
vi.mock("../../shared/rpc.js", () => ({
  getLegacyConnection: vi.fn().mockResolvedValue({
    simulateTransaction: (...args: any[]) => mockSimulateTransaction(...args),
  }),
  getRpc: vi.fn().mockReturnValue({}),
}));

const { simulateTransaction } = await import("../services/tx-preview.js");

const WALLET = "11111111111111111111111111111112";

const BASIC_IX: SerializableInstruction = {
  programAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  accounts: [],
  data: "AQAAAA==",
};

// Build a ComputeBudget setComputeUnitPrice instruction (discriminator 0x03)
// Data: 1 byte discriminator + 8 byte little-endian u64 (microLamports)
function makeSetCuPriceInstruction(microLamports: number): SerializableInstruction {
  const buf = Buffer.alloc(9);
  buf[0] = 0x03; // SET_CU_PRICE_DISCRIMINATOR
  buf.writeBigUInt64LE(BigInt(microLamports), 1);
  return {
    programAddress: "ComputeBudget111111111111111111111111111111",
    accounts: [],
    data: buf.toString("base64"),
  };
}

describe("simulateTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildRawTransaction.mockResolvedValue({
      tx: { type: "mock_versioned_tx" },
      blockhash: "test_hash",
      lastValidBlockHeight: 100,
    });
  });

  it("returns success with compute units and base fee", async () => {
    mockSimulateTransaction.mockResolvedValue({
      value: { err: null, unitsConsumed: 200_000, logs: ["log1"] },
    });

    const result = await simulateTransaction([BASIC_IX], WALLET);

    expect(result.success).toBe(true);
    expect(result.computeUnits).toBe(200_000);
    expect(result.fee).toBe(5000); // base fee only (no priority)
    expect(result.error).toBeNull();
    expect(result.logs).toEqual(["log1"]);
  });

  it("calculates priority fee from ComputeBudget instruction", async () => {
    mockSimulateTransaction.mockResolvedValue({
      value: { err: null, unitsConsumed: 100_000, logs: [] },
    });

    // 10,000 microLamports per CU
    const cuPriceIx = makeSetCuPriceInstruction(10_000);

    const result = await simulateTransaction(
      [cuPriceIx, BASIC_IX],
      WALLET,
    );

    expect(result.success).toBe(true);
    expect(result.computeUnits).toBe(100_000);
    // fee = 5000 + ceil(100_000 * 10_000 / 1_000_000) = 5000 + 1000 = 6000
    expect(result.fee).toBe(6000);
  });

  it("returns fee = 5000 when no priority fee instruction", async () => {
    mockSimulateTransaction.mockResolvedValue({
      value: { err: null, unitsConsumed: 50_000, logs: [] },
    });

    const result = await simulateTransaction([BASIC_IX], WALLET);
    expect(result.fee).toBe(5000);
  });

  it("returns null fee when compute units is null", async () => {
    mockSimulateTransaction.mockResolvedValue({
      value: { err: null, unitsConsumed: undefined, logs: [] },
    });

    const result = await simulateTransaction([BASIC_IX], WALLET);
    expect(result.success).toBe(true);
    expect(result.computeUnits).toBeNull();
    expect(result.fee).toBeNull();
  });

  it("returns error for failed simulation", async () => {
    mockSimulateTransaction.mockResolvedValue({
      value: {
        err: { InstructionError: [0, "InsufficientFunds"] },
        unitsConsumed: 150_000,
        logs: ["error: insufficient funds"],
      },
    });

    const result = await simulateTransaction([BASIC_IX], WALLET);

    expect(result.success).toBe(false);
    expect(result.error).toContain("InsufficientFunds");
    expect(result.computeUnits).toBe(150_000);
  });

  it("handles simulation crash gracefully", async () => {
    mockBuildRawTransaction.mockRejectedValue(new Error("RPC timeout"));

    const result = await simulateTransaction([BASIC_IX], WALLET);

    expect(result.success).toBe(false);
    expect(result.error).toBe("RPC timeout");
    expect(result.computeUnits).toBeNull();
    expect(result.fee).toBeNull();
  });
});
