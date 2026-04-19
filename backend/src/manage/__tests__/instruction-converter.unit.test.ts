/**
 * Unit tests for instruction-converter.ts — legacy → kit instruction conversion.
 */
import { describe, it, expect } from "vitest";
import {
  convertLegacyInstruction,
  convertJupiterApiInstruction,
} from "../services/instruction-converter.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("convertLegacyInstruction", () => {
  it("converts legacy shape to @solana/kit Instruction", () => {
    const legacy = {
      programId: { toBase58: () => "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" },
      keys: [
        {
          pubkey: { toBase58: () => "AccountA111111111111111111111111111111111111" },
          isSigner: true,
          isWritable: true,
        },
        {
          pubkey: { toBase58: () => "AccountB111111111111111111111111111111111111" },
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: { toBase58: () => "AccountC111111111111111111111111111111111111" },
          isSigner: true,
          isWritable: false,
        },
        {
          pubkey: { toBase58: () => "AccountD111111111111111111111111111111111111" },
          isSigner: false,
          isWritable: false,
        },
      ],
      data: Buffer.from([1, 2, 3]),
    };

    const result = convertLegacyInstruction(legacy) as any;

    expect(result.programAddress).toBe("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    expect(result.accounts).toHaveLength(4);
    // writable + signer = role 3
    expect(result.accounts[0]).toEqual({
      address: "AccountA111111111111111111111111111111111111",
      role: 3,
    });
    // writable, not signer = role 1
    expect(result.accounts[1]).toEqual({
      address: "AccountB111111111111111111111111111111111111",
      role: 1,
    });
    // readonly signer = role 2
    expect(result.accounts[2]).toEqual({
      address: "AccountC111111111111111111111111111111111111",
      role: 2,
    });
    // readonly = role 0
    expect(result.accounts[3]).toEqual({
      address: "AccountD111111111111111111111111111111111111",
      role: 0,
    });
    // data is Uint8Array
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect([...result.data]).toEqual([1, 2, 3]);
  });

  it("handles empty keys array", () => {
    const legacy = {
      programId: { toBase58: () => "11111111111111111111111111111111" },
      keys: [],
      data: Buffer.from([]),
    };

    const result = convertLegacyInstruction(legacy) as any;
    expect(result.accounts).toEqual([]);
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(result.data.length).toBe(0);
  });
});

describe("convertJupiterApiInstruction", () => {
  it("converts Jupiter API JSON shape to @solana/kit Instruction", () => {
    const jupiterIx = {
      programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
      accounts: [
        { pubkey: "AccA", isSigner: true, isWritable: true },
        { pubkey: "AccB", isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1, 2, 3]).toString("base64"), // "AQID"
    };

    const result = convertJupiterApiInstruction(jupiterIx) as any;

    expect(result.programAddress).toBe("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    expect(result.accounts[0]).toEqual({ address: "AccA", role: 3 });
    expect(result.accounts[1]).toEqual({ address: "AccB", role: 0 });
    // Data is decoded from base64
    expect([...result.data]).toEqual([1, 2, 3]);
  });

  it("maps all 4 role combinations correctly", () => {
    const jupiterIx = {
      programId: "Test",
      accounts: [
        { pubkey: "A", isSigner: true, isWritable: true },   // 3
        { pubkey: "B", isSigner: true, isWritable: false },  // 2
        { pubkey: "C", isSigner: false, isWritable: true },  // 1
        { pubkey: "D", isSigner: false, isWritable: false }, // 0
      ],
      data: "",
    };

    const result = convertJupiterApiInstruction(jupiterIx) as any;
    expect(result.accounts.map((a: any) => a.role)).toEqual([3, 2, 1, 0]);
  });
});
