/**
 * Unit tests for tx-assembler.ts — unsigned transaction assembly.
 * Mocks RPC and @solana/web3.js to test instruction→transaction conversion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SerializableInstruction } from "../../shared/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock RPC
const mockGetLatestBlockhash = vi.fn();
const mockGetAddressLookupTable = vi.fn();

vi.mock("../../shared/rpc.js", () => ({
  getRpc: vi.fn().mockReturnValue({
    getLatestBlockhash: () => ({
      send: mockGetLatestBlockhash,
    }),
  }),
  getLegacyConnection: vi.fn().mockResolvedValue({
    getAddressLookupTable: (...args: any[]) => mockGetAddressLookupTable(...args),
  }),
}));

// Mock @solana/web3.js
const mockSerialize = vi.fn().mockReturnValue(new Uint8Array([1, 2, 3, 4]));
vi.mock("@solana/web3.js", () => {
  class MockPublicKey {
    _key: string;
    constructor(key: string) { this._key = key; }
    toString() { return this._key; }
    toBase58() { return this._key; }
  }

  class MockTransactionInstruction {
    programId: any;
    keys: any[];
    data: Buffer;
    constructor(opts: any) {
      this.programId = opts.programId;
      this.keys = opts.keys;
      this.data = opts.data;
    }
  }

  class MockTransactionMessage {
    constructor(_opts: any) {}
    compileToV0Message(_alts?: any[]) { return { type: "v0message" }; }
  }

  class MockVersionedTransaction {
    message: any;
    constructor(message: any) { this.message = message; }
    serialize() { return mockSerialize(); }
  }

  return {
    PublicKey: MockPublicKey,
    TransactionInstruction: MockTransactionInstruction,
    TransactionMessage: MockTransactionMessage,
    VersionedTransaction: MockVersionedTransaction,
  };
});

const { buildRawTransaction, assembleTransaction } = await import(
  "../services/tx-assembler.js"
);

const MOCK_INSTRUCTION: SerializableInstruction = {
  programAddress: "ComputeBudget111111111111111111111111111111",
  accounts: [
    { address: "Account111111111111111111111111111111111111", role: 3 },
  ],
  data: "AQAAAA==", // base64 of [1,0,0,0]
};
const WALLET = "11111111111111111111111111111112";

describe("buildRawTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLatestBlockhash.mockResolvedValue({
      value: {
        blockhash: "test_blockhash_abc",
        lastValidBlockHeight: 500n,
      },
      context: { slot: 100n },
    });
  });

  it("builds v0 transaction from serialized instructions", async () => {
    const result = await buildRawTransaction([MOCK_INSTRUCTION], WALLET);

    expect(result.tx).toBeDefined();
    expect(result.blockhash).toBe("test_blockhash_abc");
    expect(result.lastValidBlockHeight).toBe(500);
    expect(mockGetLatestBlockhash).toHaveBeenCalledTimes(1);
  });

  it("handles empty instruction array", async () => {
    const result = await buildRawTransaction([], WALLET);
    expect(result.tx).toBeDefined();
    expect(result.blockhash).toBeTruthy();
  });

  it("loads address lookup tables when provided", async () => {
    mockGetAddressLookupTable.mockResolvedValue({ value: { state: "mock_lut" } });

    const result = await buildRawTransaction(
      [MOCK_INSTRUCTION],
      WALLET,
      ["ALT111111111111111111111111111111111111111"],
    );

    expect(result.tx).toBeDefined();
    expect(mockGetAddressLookupTable).toHaveBeenCalledTimes(1);
  });

  it("filters out null lookup tables", async () => {
    mockGetAddressLookupTable
      .mockResolvedValueOnce({ value: { state: "valid_lut" } })
      .mockResolvedValueOnce({ value: null });

    const result = await buildRawTransaction(
      [MOCK_INSTRUCTION],
      WALLET,
      ["ALT1_valid", "ALT2_invalid"],
    );

    expect(result.tx).toBeDefined();
    expect(mockGetAddressLookupTable).toHaveBeenCalledTimes(2);
  });

  it("skips lookup table loading when no addresses provided", async () => {
    await buildRawTransaction([MOCK_INSTRUCTION], WALLET);
    expect(mockGetAddressLookupTable).not.toHaveBeenCalled();
  });
});

describe("assembleTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLatestBlockhash.mockResolvedValue({
      value: {
        blockhash: "test_blockhash_def",
        lastValidBlockHeight: 600n,
      },
      context: { slot: 100n },
    });
  });

  it("returns base64 transaction with blockhash", async () => {
    const result = await assembleTransaction([MOCK_INSTRUCTION], WALLET);

    expect(typeof result.transaction).toBe("string");
    // Base64 of [1,2,3,4] from mock serialize
    expect(result.transaction).toBe(
      Buffer.from([1, 2, 3, 4]).toString("base64"),
    );
    expect(result.blockhash).toBe("test_blockhash_def");
    expect(result.lastValidBlockHeight).toBe(600);
  });
});
