import { describe, it, expect } from "vitest";
import { serializeInstruction, serializeResult } from "../services/instruction-serializer.js";
import type { Instruction } from "@solana/kit";

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeInstruction(): Instruction {
  return {
    programAddress: "ComputeBudget111111111111111111111111111111" as any,
    accounts: [
      { address: "L5pTcaF2fSbe1FwEtkN2KYsf6ayh5utPZbuegRi98RK" as any, role: 3 },
      { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as any, role: 0 },
    ],
    data: new Uint8Array([1, 2, 3, 4]) as any,
  } as unknown as Instruction;
}

describe("serializeInstruction", () => {
  it("converts Instruction to JSON-safe format", () => {
    const ix = makeInstruction();
    const serialized = serializeInstruction(ix);
    expect(serialized.programAddress).toBe("ComputeBudget111111111111111111111111111111");
    expect(serialized.accounts).toHaveLength(2);
    expect(serialized.accounts[0].role).toBe(3);
    expect(typeof serialized.data).toBe("string"); // base64
  });

  it("preserves data via base64 roundtrip", () => {
    const ix = makeInstruction();
    const serialized = serializeInstruction(ix);
    const decoded = Buffer.from(serialized.data, "base64");
    expect(Array.from(decoded)).toEqual([1, 2, 3, 4]);
  });
});

describe("serializeResult", () => {
  it("serializes plain Instruction[]", () => {
    const result = [makeInstruction()];
    const serialized = serializeResult(result);
    expect(serialized.instructions).toHaveLength(1);
    expect(serialized.lookupTableAddresses).toBeUndefined();
  });

  it("serializes BuildTxResultWithLookups", () => {
    const result = {
      instructions: [makeInstruction()],
      lookupTableAddresses: ["ALT_ADDRESS_1", "ALT_ADDRESS_2"],
    };
    const serialized = serializeResult(result);
    expect(serialized.instructions).toHaveLength(1);
    expect(serialized.lookupTableAddresses).toEqual(["ALT_ADDRESS_1", "ALT_ADDRESS_2"]);
  });

  it("passes through metadata", () => {
    const result = {
      instructions: [makeInstruction()],
      lookupTableAddresses: ["ALT"],
      metadata: { nft_id: 42, vault_id: 68 },
    };
    const serialized = serializeResult(result);
    expect(serialized.metadata).toEqual({ nft_id: 42, vault_id: 68 });
  });

  it("serializes BuildTxResultWithSetup", () => {
    const result = {
      instructions: [makeInstruction()],
      lookupTableAddresses: ["ALT"],
      setupInstructionSets: [[makeInstruction()]],
    };
    const serialized = serializeResult(result);
    expect(serialized.setupInstructionSets).toHaveLength(1);
    expect(serialized.setupInstructionSets![0]).toHaveLength(1);
  });
});
