import type { SerializableInstruction } from "../../shared/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Known Solana program addresses for testing program whitelist. */
export const PROGRAMS = {
  computeBudget: "ComputeBudget111111111111111111111111111111",
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  associatedToken: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  systemProgram: "11111111111111111111111111111111",
  jupiterV6: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  kaminoLending: "KLend2g3cP87ber8LQsMR4uo7xEkE5RKEHPkjkgQdro",
  unknown: "UnknownProgramXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
};

/** Create a mock @solana/kit Instruction for adapter testing. */
export function mockInstruction(programAddress?: string, numAccounts = 0) {
  return {
    programAddress: (programAddress ?? PROGRAMS.computeBudget) as any,
    accounts: Array.from({ length: numAccounts }, (_, i) => ({
      address: `Account${String(i).padStart(39, "1")}` as any,
      role: i === 0 ? 3 : 1, // first is writable signer, rest writable
    })),
    data: new Uint8Array([1, 0, 0, 0]),
  };
}

/** Pre-built serialized instructions for testing serialization/guards. */
export const SERIALIZED: Record<string, SerializableInstruction> = {
  computeBudget: {
    programAddress: PROGRAMS.computeBudget,
    accounts: [],
    data: "AQAAAA==", // base64 of [1,0,0,0]
  },
  tokenTransfer: {
    programAddress: PROGRAMS.tokenProgram,
    accounts: [
      { address: "SourceAccount1111111111111111111111111111111", role: 3 },
      { address: "DestAccount11111111111111111111111111111111", role: 1 },
      { address: "Authority111111111111111111111111111111111111", role: 2 },
    ],
    data: "AQAAAA==",
  },
  unknownProgram: {
    programAddress: PROGRAMS.unknown,
    accounts: [],
    data: "",
  },
};
